CREATE TABLE "client_sessions" (
	"id_hash" varchar(64) PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"encrypted_key" varchar NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_sessions" ADD CONSTRAINT "client_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_predefined_name_type_unique" ON "plans" USING btree ("type",lower(trim("name"))) WHERE "plans"."is_predefined" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_custom_owner_name_type_unique" ON "plans" USING btree ("account_id","type",lower(trim("name"))) WHERE "plans"."is_predefined" = false;