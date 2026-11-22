import nodemailer, { type Transporter } from 'nodemailer';
import { InfraConfigurationError, resolveInfraConfig, type EmailConfig, type EmailProviderName } from '../config.ts';
import { logger } from '../logger.ts';

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface EmailDeliveryResult {
  sent: boolean;
  provider: EmailProviderName;
  messageId?: string;
  skippedReason?: string;
}

export interface EmailProviderStatus {
  configured: boolean;
  provider: EmailProviderName;
  fromAddress: string;
  note: string;
}

export interface EmailProvider {
  readonly providerName: EmailProviderName;
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
  getStatus(): EmailProviderStatus;
}

class NoopEmailProvider implements EmailProvider {
  public readonly providerName = 'none' as const;
  private readonly fromAddress: string;

  constructor(fromAddress: string) {
    this.fromAddress = fromAddress;
  }

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    logger.debug('email_delivery_skipped_unconfigured', {
      toCount: Array.isArray(message.to) ? message.to.length : 1,
      subject: message.subject,
    });
    return {
      sent: false,
      provider: 'none',
      skippedReason: 'External email provider is unconfigured; in-app notifications remain active.',
    };
  }

  getStatus(): EmailProviderStatus {
    return {
      configured: false,
      provider: 'none',
      fromAddress: this.fromAddress,
      note: 'In-app notifications active. External email delivery is unconfigured (set EMAIL_PROVIDER=resend + RESEND_API_KEY, or EMAIL_PROVIDER=smtp + SMTP_HOST/USER/PASS to enable).',
    };
  }
}

export class ResendEmailProvider implements EmailProvider {
  public readonly providerName = 'resend' as const;
  private readonly apiKey: string;
  private readonly fromAddress: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: EmailConfig, fetchImpl: typeof fetch = fetch) {
    if (!config.resendApiKey) {
      throw new InfraConfigurationError(
        'RESEND_API_KEY_REQUIRED',
        'EMAIL_PROVIDER=resend requires RESEND_API_KEY to be set.'
      );
    }
    this.apiKey = config.resendApiKey;
    this.fromAddress = config.fromAddress;
    this.fetchImpl = fetchImpl;
  }

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Resend API error (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return {
      sent: true,
      provider: 'resend',
      messageId: data.id,
    };
  }

  getStatus(): EmailProviderStatus {
    return {
      configured: true,
      provider: 'resend',
      fromAddress: this.fromAddress,
      note: 'Resend transactional email adapter configured and ready.',
    };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  public readonly providerName = 'smtp' as const;
  private readonly config: EmailConfig;
  private readonly transporter: Transporter;

  constructor(config: EmailConfig, injectedTransporter?: Transporter) {
    if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
      throw new InfraConfigurationError(
        'SMTP_CONFIG_REQUIRED',
        'EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER, and SMTP_PASS to be configured.'
      );
    }
    this.config = config;
    this.transporter =
      injectedTransporter ||
      nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
      });
  }

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    const info = await this.transporter.sendMail({
      from: this.config.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
    });
    return {
      sent: true,
      provider: 'smtp',
      messageId: info.messageId,
    };
  }

  getStatus(): EmailProviderStatus {
    return {
      configured: true,
      provider: 'smtp',
      fromAddress: this.config.fromAddress,
      note: `SMTP relay configured (${this.config.smtp.host}:${this.config.smtp.port}).`,
    };
  }
}

declare global {
  var _ouroEmailProvider: EmailProvider | undefined;
}

export function createEmailProvider(customConfig?: EmailConfig): EmailProvider {
  const cfg = customConfig || resolveInfraConfig().email;
  switch (cfg.provider) {
    case 'resend':
      return new ResendEmailProvider(cfg);
    case 'smtp':
      return new SmtpEmailProvider(cfg);
    case 'none':
    default:
      return new NoopEmailProvider(cfg.fromAddress);
  }
}

export function getEmailProvider(): EmailProvider {
  if (!global._ouroEmailProvider) {
    global._ouroEmailProvider = createEmailProvider();
  }
  return global._ouroEmailProvider;
}

export function resetEmailProviderForTests(): void {
  global._ouroEmailProvider = undefined;
}
