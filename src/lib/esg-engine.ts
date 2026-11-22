import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { emissionFactors } from '../db/schema.ts';
import { MATERIAL_METADATA, type MaterialCategory } from '../shared/constants.ts';

export interface EmissionFactorRecord {
  materialCategory: string;
  labelEn: string;
  labelAr: string;
  co2eFactorPerTon: number;
  transportFactorKgPerTonKm: number;
  methodologyName: string;
  sourceRef: string;
  version: string;
  boundaryNotes: string;
  baselineScenario: string;
  dataQualityTier: string;
}

export const DEFAULT_EMISSION_FACTORS: EmissionFactorRecord[] = [
  {
    materialCategory: 'paper_cardboard',
    labelEn: 'Paper & Cardboard',
    labelAr: 'الورق والكرتون',
    co2eFactorPerTon: 3.14,
    transportFactorKgPerTonKm: 0.105,
    methodologyName: 'US EPA WARM v16 + DEFRA 2024 Freight',
    sourceRef: 'US EPA Waste Reduction Model (WARM) v16 — Corrugated Containers & Mixed Paper Recycling',
    version: 'EPA-WARM-v16.0 / DEFRA-2024',
    boundaryNotes:
      'Cradle-to-gate secondary pulp substitution minus heavy-duty diesel road freight (3PL haulage) and non-recovered processing residuals.',
    baselineScenario: 'Egyptian municipal open/engineered landfill disposal with virgin kraft fiber production.',
    dataQualityTier: 'Tier 2 — Regional Industrial Secondary Data',
  },
  {
    materialCategory: 'plastics',
    labelEn: 'Plastics (PET / HDPE / PP)',
    labelAr: 'البلاستيك (PET / HDPE / PP)',
    co2eFactorPerTon: 1.52,
    transportFactorKgPerTonKm: 0.105,
    methodologyName: 'US EPA WARM v16 & IPCC 2006 Vol. 5',
    sourceRef: 'US EPA WARM v16 (PET/HDPE Closed-Loop Recycling) & IPCC 2006 Guidelines',
    version: 'EPA-WARM-v16.0 / IPCC-2006',
    boundaryNotes:
      'Virgin petrochemical resin displacement calculated strictly on verified washed flake / pellet recovered output minus 3PL road transport.',
    baselineScenario: 'Landfill disposal with virgin PET/HDPE polymer manufacturing.',
    dataQualityTier: 'Tier 2 — Regional Industrial Secondary Data',
  },
  {
    materialCategory: 'metals',
    labelEn: 'Metals (Aluminum / Steel)',
    labelAr: 'المعادن (ألومنيوم / صلب)',
    co2eFactorPerTon: 4.85,
    transportFactorKgPerTonKm: 0.105,
    methodologyName: 'US EPA WARM v16 / Worldsteel & IAI Blended Factor',
    sourceRef: 'US EPA WARM v16 & International Aluminium Institute Secondary Smelting Methodology',
    version: 'EPA-WARM-v16.0 / IAI-2024',
    boundaryNotes:
      'Primary ore smelting avoidance applied exclusively to verified smelted/recovered metal mass after dross/contamination loss deduction.',
    baselineScenario: 'Landfill disposal with primary bauxite/iron-ore smelting.',
    dataQualityTier: 'Tier 2 — Regional Industrial Secondary Data',
  },
  {
    materialCategory: 'organic',
    labelEn: 'Agricultural & Organic Recyclables',
    labelAr: 'المخلفات الزراعية والعضوية القابلة للتدوير',
    co2eFactorPerTon: 0.86,
    transportFactorKgPerTonKm: 0.105,
    methodologyName: 'IPCC 2006 Vol. 5 — Aerobic Composting & Biomass Valorization',
    sourceRef: 'IPCC 2006 Guidelines for National GHG Inventories (Waste Sector, Ch. 4)',
    version: 'IPCC-2006-V5 / DEFRA-2024',
    boundaryNotes:
      'Methane avoidance from aerobic composting/biomass valorization applied only to verified processed organic feedstock minus haulage.',
    baselineScenario: 'Anaerobic decomposition in unmanaged landfill or open agricultural burning.',
    dataQualityTier: 'Tier 2 — Regional Industrial Secondary Data',
  },
];

export async function getEmissionFactorMap(): Promise<Record<string, EmissionFactorRecord>> {
  const rows = await db.select().from(emissionFactors);
  const map: Record<string, EmissionFactorRecord> = {};
  for (const def of DEFAULT_EMISSION_FACTORS) {
    map[def.materialCategory] = def;
  }
  for (const r of rows) {
    map[r.materialCategory] = {
      materialCategory: r.materialCategory,
      labelEn: r.labelEn,
      labelAr: r.labelAr,
      co2eFactorPerTon: r.co2eFactorPerTon,
      transportFactorKgPerTonKm: r.transportFactorKgPerTonKm,
      methodologyName: r.methodologyName,
      sourceRef: r.sourceRef,
      version: r.version,
      boundaryNotes: r.boundaryNotes,
      baselineScenario: r.baselineScenario,
      dataQualityTier: r.dataQualityTier,
    };
  }
  return map;
}

export async function getEmissionFactorForCategory(category: string): Promise<EmissionFactorRecord> {
  const rows = await db
    .select()
    .from(emissionFactors)
    .where(eq(emissionFactors.materialCategory, category))
    .limit(1);
  if (rows.length > 0) {
    return rows[0];
  }
  const fallback = DEFAULT_EMISSION_FACTORS.find((d) => d.materialCategory === category);
  if (fallback) return fallback;
  const meta = MATERIAL_METADATA[category as MaterialCategory] || MATERIAL_METADATA.paper_cardboard;
  return {
    materialCategory: category,
    labelEn: meta.en,
    labelAr: meta.ar,
    co2eFactorPerTon: meta.co2eFactorPerTon,
    transportFactorKgPerTonKm: 0.105,
    methodologyName: meta.methodologyRef,
    sourceRef: meta.methodologyRef,
    version: 'EPA-WARM-v16.0',
    boundaryNotes: 'Standard secondary material substitution minus freight emissions.',
    baselineScenario: 'Landfill disposal with virgin production.',
    dataQualityTier: 'Tier 2 — Regional Industrial Secondary Data',
  };
}

export const ESG_METHODOLOGY_LIMITATIONS = {
  geographicScope:
    'Secondary emission factors are adapted from US EPA WARM v16, UK DEFRA 2024, and IPCC 2006 Vol. 5 proxies. Actual Egyptian/MENA industrial electricity grid intensity, regional sorting yields, and local landfill methane capture rates may differ; facility-specific LCA factors should be substituted once audited.',
  transportAssumption:
    'Freight distance uses geodesic Haversine corridor distance (km) between verified generator and recycling factory coordinates multiplied by a 1.25x road circuity adjustment factor when live route telemetry is unavailable.',
  verifierRequirement:
    'Only shipments with independent Platform Verifier / Admin approval of Stage 7 recycling evidence enter Verified Recycled Tonnage and Net Verified CO2e totals. Unverified submissions remain in Delivered/Pending status.',
};

export interface EsgImpactCalculation {
  recoveredTons: number;
  deliveredTons: number;
  residualTons: number;
  lossTons: number;
  recoveryYieldPct: number;
  transportDistanceKm: number;
  effectiveRoadKm: number;
  grossRecyclingCo2eTons: number;
  transportEmissionsTons: number;
  netVerifiedCo2eTons: number;
  confidenceLevel: 'estimated' | 'calculated' | 'verified';
  factorUsed: number;
  factorVersion: string;
}

/**
 * Scientifically defensible net GHG avoided calculation:
 * - Gross savings apply STRICTLY to verified recovered output (NEVER raw listed or raw delivered weight).
 * - Heavy-duty 3PL freight transport emissions (kg CO2e / ton-km) are deducted using road-adjusted km.
 * - Confidence tier is explicitly classified based on independent approval AND evidence completeness:
 *   - 'verified': Independent verifier approved + BOTH weighbridge intake weight/ticket AND recycling evidence file.
 *   - 'calculated': Independent verifier approved without the full dual documentary pair.
 *   - 'estimated': Pre-approval projection (never included in verified totals).
 */
export function calculateVerifiedRecyclingImpact(params: {
  recoveredTons: number;
  deliveredTons: number;
  residualTons: number;
  lossTons: number;
  transportDistanceKm: number;
  factor: EmissionFactorRecord;
  hasWeighbridgeTicket: boolean;
  hasRecyclingEvidence: boolean;
  verifierApproved?: boolean;
  roadCircuityMultiplier?: number;
}): EsgImpactCalculation {
  const {
    recoveredTons,
    deliveredTons,
    residualTons,
    lossTons,
    transportDistanceKm,
    factor,
    hasWeighbridgeTicket,
    hasRecyclingEvidence,
    verifierApproved = true,
    roadCircuityMultiplier = 1.25,
  } = params;

  const grossRecyclingCo2eTons = Number((recoveredTons * factor.co2eFactorPerTon).toFixed(3));
  const safeStraightKm = Math.max(0, transportDistanceKm);
  const effectiveRoadKm = Number((safeStraightKm * roadCircuityMultiplier).toFixed(1));
  // Freight emissions occur on the full delivered tonnage hauled from generator to recycling facility
  const transportEmissionsTons = Number(
    ((deliveredTons * effectiveRoadKm * factor.transportFactorKgPerTonKm) / 1000).toFixed(3)
  );
  const netVerifiedCo2eTons = Number(
    Math.max(0, grossRecyclingCo2eTons - transportEmissionsTons).toFixed(3)
  );
  const recoveryYieldPct =
    deliveredTons > 0 ? Number(((recoveredTons / deliveredTons) * 100).toFixed(1)) : 0;

  let confidenceLevel: 'estimated' | 'calculated' | 'verified' = 'estimated';
  if (verifierApproved) {
    confidenceLevel = hasRecyclingEvidence && hasWeighbridgeTicket ? 'verified' : 'calculated';
  }

  return {
    recoveredTons: Number(recoveredTons.toFixed(3)),
    deliveredTons: Number(deliveredTons.toFixed(3)),
    residualTons: Number(residualTons.toFixed(3)),
    lossTons: Number(lossTons.toFixed(3)),
    recoveryYieldPct,
    transportDistanceKm: Number(safeStraightKm.toFixed(1)),
    effectiveRoadKm,
    grossRecyclingCo2eTons,
    transportEmissionsTons,
    netVerifiedCo2eTons,
    confidenceLevel,
    factorUsed: factor.co2eFactorPerTon,
    factorVersion: factor.version,
  };
}
