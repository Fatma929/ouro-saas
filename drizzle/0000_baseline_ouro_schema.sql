CREATE TABLE "admin_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_code" text NOT NULL,
	"passport_id" integer,
	"reservation_id" integer,
	"raised_by_user_id" integer NOT NULL,
	"raised_by_org_name" text NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"description" text NOT NULL,
	"resolution_note" text,
	"resolved_by_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	CONSTRAINT "disputes_dispute_code_unique" UNIQUE("dispute_code")
);
--> statement-breakpoint
CREATE TABLE "emission_factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"material_category" text NOT NULL,
	"label_en" text NOT NULL,
	"label_ar" text NOT NULL,
	"co2e_factor_per_ton" double precision NOT NULL,
	"transport_factor_kg_per_ton_km" double precision DEFAULT 0.105 NOT NULL,
	"methodology_name" text NOT NULL,
	"source_ref" text NOT NULL,
	"version" text NOT NULL,
	"boundary_notes" text NOT NULL,
	"baseline_scenario" text NOT NULL,
	"data_quality_tier" text DEFAULT 'Tier 2 — Regional Industrial Secondary Data' NOT NULL,
	"updated_by_email" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "emission_factors_material_category_unique" UNIQUE("material_category")
);
--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"purpose" text NOT NULL,
	"storage_path" text,
	"sha256" text,
	"data_base64" text DEFAULT '' NOT NULL,
	"uploaded_by_uid" text,
	"owner_org_type" text,
	"owner_org_id" integer,
	"linked_entity_type" text,
	"linked_entity_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"status_code" integer NOT NULL,
	"response_json" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "logistics_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"env_transport_license_id" text NOT NULL,
	"license_expiry" text NOT NULL,
	"fleet_count" integer DEFAULT 8 NOT NULL,
	"on_time_rate" double precision DEFAULT 96.5 NOT NULL,
	"contact_phone" text NOT NULL,
	"verification_status" text DEFAULT 'approved' NOT NULL,
	"is_verified" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "logistics_providers_env_transport_license_id_unique" UNIQUE("env_transport_license_id")
);
--> statement-breakpoint
CREATE TABLE "logistics_vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"logistics_provider_id" integer NOT NULL,
	"plate_number" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"capacity_tons" double precision NOT NULL,
	"env_permit_no" text NOT NULL,
	"permit_expiry" text NOT NULL,
	"driver_name" text NOT NULL,
	"verification_status" text DEFAULT 'verified' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "logistics_vehicles_plate_number_unique" UNIQUE("plate_number")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"target_role" text,
	"type" text NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"message_en" text NOT NULL,
	"message_ar" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"passport_id" integer NOT NULL,
	"stage" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor_name" text NOT NULL,
	"actor_role" text NOT NULL,
	"summary_en" text NOT NULL,
	"summary_ar" text NOT NULL,
	"metadata_json" text,
	"evidence_file_id" integer,
	"lat" double precision,
	"lng" double precision,
	"prev_hash" text DEFAULT 'GENESIS' NOT NULL,
	"event_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recycling_factories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"industrial_zone" text NOT NULL,
	"governorate" text NOT NULL,
	"tax_id" text NOT NULL,
	"commercial_reg_no" text NOT NULL,
	"contact_person" text NOT NULL,
	"phone" text NOT NULL,
	"preferred_categories" text DEFAULT '["paper_cardboard","plastics"]' NOT NULL,
	"monthly_capacity_tons" double precision DEFAULT 250 NOT NULL,
	"accepted_grades" text DEFAULT '["Grade A","Grade B"]' NOT NULL,
	"procurement_notes" text,
	"kyc_status" text DEFAULT 'pending' NOT NULL,
	"kyc_document_file_id" integer,
	"kyc_document_name" text,
	"kyc_review_note" text,
	"kyc_reviewed_by_uid" text,
	"kyc_reviewed_at" timestamp,
	"lat" double precision DEFAULT 29.972 NOT NULL,
	"lng" double precision DEFAULT 30.942 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservation_code" text NOT NULL,
	"passport_id" integer NOT NULL,
	"hub_id" integer NOT NULL,
	"factory_id" integer NOT NULL,
	"logistics_provider_id" integer NOT NULL,
	"driver_user_id" integer,
	"vehicle_id" integer,
	"quantity_tons" double precision NOT NULL,
	"price_per_ton_egp" double precision NOT NULL,
	"total_egp" double precision NOT NULL,
	"pickup_window" text NOT NULL,
	"pickup_status" text DEFAULT 'scheduled' NOT NULL,
	"accepted_by_3pl_at" timestamp,
	"handoff_weight_kg" double precision,
	"handoff_verification_method" text,
	"handoff_qr_verified" boolean DEFAULT false NOT NULL,
	"handoff_gps_lat" double precision,
	"handoff_gps_lng" double precision,
	"handoff_verified_at" timestamp,
	"delivered_at" timestamp,
	"pod_file_id" integer,
	"pod_file_name" text,
	"receipt_status" text DEFAULT 'pending' NOT NULL,
	"received_at" timestamp,
	"received_weight_kg" double precision,
	"weighbridge_file_id" integer,
	"weighbridge_file_name" text,
	"recycling_status" text DEFAULT 'not_started' NOT NULL,
	"recycled_at" timestamp,
	"recovered_tons" double precision DEFAULT 0 NOT NULL,
	"residual_tons" double precision DEFAULT 0 NOT NULL,
	"loss_tons" double precision DEFAULT 0 NOT NULL,
	"recycling_evidence_file_id" integer,
	"recycling_evidence_name" text,
	"recycling_notes" text,
	"transport_distance_km" double precision DEFAULT 0 NOT NULL,
	"transport_emissions_tons" double precision DEFAULT 0 NOT NULL,
	"co2e_avoided_tons" double precision DEFAULT 0 NOT NULL,
	"estimated_co2e_tons" double precision DEFAULT 0 NOT NULL,
	"esg_confidence_level" text DEFAULT 'estimated' NOT NULL,
	"expires_at" timestamp,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_reservation_code_unique" UNIQUE("reservation_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"full_name" text NOT NULL,
	"phone" text,
	"account_code" text,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"hub_id" integer,
	"factory_id" integer,
	"logistics_provider_id" integer,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_uid_unique" UNIQUE("uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_account_code_unique" UNIQUE("account_code")
);
--> statement-breakpoint
CREATE TABLE "waste_passports" (
	"id" serial PRIMARY KEY NOT NULL,
	"passport_code" text NOT NULL,
	"hub_id" integer NOT NULL,
	"material_category" text NOT NULL,
	"material_subtype" text NOT NULL,
	"purity_grade" text NOT NULL,
	"initial_weight_kg" double precision NOT NULL,
	"available_tons" double precision NOT NULL,
	"reserved_tons" double precision DEFAULT 0 NOT NULL,
	"collected_tons" double precision DEFAULT 0 NOT NULL,
	"delivered_tons" double precision DEFAULT 0 NOT NULL,
	"recycled_tons" double precision DEFAULT 0 NOT NULL,
	"residual_tons" double precision DEFAULT 0 NOT NULL,
	"rejected_tons" double precision DEFAULT 0 NOT NULL,
	"price_per_ton_egp" double precision NOT NULL,
	"verification_method" text NOT NULL,
	"photo_file_id" integer,
	"photo_url" text,
	"supporting_doc_file_id" integer,
	"supporting_doc_name" text,
	"notes" text,
	"pickup_window" text NOT NULL,
	"current_stage" integer DEFAULT 3 NOT NULL,
	"lifecycle_status" text DEFAULT 'LISTED' NOT NULL,
	"status" text DEFAULT 'listed' NOT NULL,
	"co2e_factor_per_ton" double precision NOT NULL,
	"emission_factor_version" text DEFAULT 'EPA WARM v16 / IPCC 2006' NOT NULL,
	"verified_co2e_tons" double precision DEFAULT 0 NOT NULL,
	"is_sample_data" boolean DEFAULT false NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waste_passports_passport_code_unique" UNIQUE("passport_code")
);
--> statement-breakpoint
CREATE TABLE "waste_source_hubs" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"hub_type" text NOT NULL,
	"commercial_reg_no" text,
	"contact_phone" text,
	"verification_status" text DEFAULT 'verified' NOT NULL,
	"governorate" text NOT NULL,
	"address" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"max_capacity_tons" double precision DEFAULT 40 NOT NULL,
	"available_tons" double precision DEFAULT 0 NOT NULL,
	"reserved_tons" double precision DEFAULT 0 NOT NULL,
	"purity_score" double precision DEFAULT 94 NOT NULL,
	"last_pickup_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waste_source_hubs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_passport_id_waste_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."waste_passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_vehicles" ADD CONSTRAINT "logistics_vehicles_logistics_provider_id_logistics_providers_id_fk" FOREIGN KEY ("logistics_provider_id") REFERENCES "public"."logistics_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_events" ADD CONSTRAINT "passport_events_passport_id_waste_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."waste_passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_events" ADD CONSTRAINT "passport_events_evidence_file_id_file_objects_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_passport_id_waste_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."waste_passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_hub_id_waste_source_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."waste_source_hubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_factory_id_recycling_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."recycling_factories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_logistics_provider_id_logistics_providers_id_fk" FOREIGN KEY ("logistics_provider_id") REFERENCES "public"."logistics_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driver_user_id_users_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_logistics_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."logistics_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_pod_file_id_file_objects_id_fk" FOREIGN KEY ("pod_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_weighbridge_file_id_file_objects_id_fk" FOREIGN KEY ("weighbridge_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_recycling_evidence_file_id_file_objects_id_fk" FOREIGN KEY ("recycling_evidence_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_hub_id_waste_source_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."waste_source_hubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_factory_id_recycling_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."recycling_factories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_logistics_provider_id_logistics_providers_id_fk" FOREIGN KEY ("logistics_provider_id") REFERENCES "public"."logistics_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_passports" ADD CONSTRAINT "waste_passports_hub_id_waste_source_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."waste_source_hubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_passports" ADD CONSTRAINT "waste_passports_photo_file_id_file_objects_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_passports" ADD CONSTRAINT "waste_passports_supporting_doc_file_id_file_objects_id_fk" FOREIGN KEY ("supporting_doc_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_passports" ADD CONSTRAINT "waste_passports_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_disputes_status" ON "disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_idempotency_key" ON "idempotency_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_vehicles_provider" ON "logistics_vehicles" USING btree ("logistics_provider_id");--> statement-breakpoint
CREATE INDEX "idx_notif_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notif_role" ON "notifications" USING btree ("target_role");--> statement-breakpoint
CREATE INDEX "idx_events_passport" ON "passport_events" USING btree ("passport_id");--> statement-breakpoint
CREATE INDEX "idx_factories_kyc" ON "recycling_factories" USING btree ("kyc_status");--> statement-breakpoint
CREATE INDEX "idx_res_passport" ON "reservations" USING btree ("passport_id");--> statement-breakpoint
CREATE INDEX "idx_res_factory" ON "reservations" USING btree ("factory_id");--> statement-breakpoint
CREATE INDEX "idx_res_provider" ON "reservations" USING btree ("logistics_provider_id");--> statement-breakpoint
CREATE INDEX "idx_res_status" ON "reservations" USING btree ("pickup_status");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_passports_hub" ON "waste_passports" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "idx_passports_lifecycle" ON "waste_passports" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE INDEX "idx_passports_category" ON "waste_passports" USING btree ("material_category");--> statement-breakpoint
CREATE INDEX "idx_hubs_governorate" ON "waste_source_hubs" USING btree ("governorate");--> statement-breakpoint
CREATE INDEX "idx_hubs_type" ON "waste_source_hubs" USING btree ("hub_type");