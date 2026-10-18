CREATE TYPE "public"."blocking_level" AS ENUM('account', 'user');--> statement-breakpoint
CREATE TYPE "public"."blocking_rule" AS ENUM('monthly_allowance', 'max_units_per_request');--> statement-breakpoint
CREATE TYPE "public"."consumption_decision" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "account_monthly_usage" (
	"account_id" uuid NOT NULL,
	"month" date NOT NULL,
	"consumed_units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "account_monthly_usage_account_id_month_pk" PRIMARY KEY("account_id","month"),
	CONSTRAINT "account_monthly_usage_consumed_units_nonnegative" CHECK ("account_monthly_usage"."consumed_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "consumption_requests" (
	"account_id" uuid NOT NULL,
	"request_id" varchar NOT NULL,
	"user_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"decision" "consumption_decision" NOT NULL,
	"blocking_level" "blocking_level",
	"blocking_rule" "blocking_rule",
	"month" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_requests_account_id_request_id_pk" PRIMARY KEY("account_id","request_id"),
	CONSTRAINT "consumption_requests_units_positive" CHECK ("consumption_requests"."units" > 0),
	CONSTRAINT "consumption_requests_request_id_nonempty" CHECK (length(trim("consumption_requests"."request_id")) > 0),
	CONSTRAINT "consumption_requests_outcome_check" CHECK ((
    ("consumption_requests"."decision" = 'accepted' AND "consumption_requests"."blocking_level" IS NULL AND "consumption_requests"."blocking_rule" IS NULL)
    OR
    ("consumption_requests"."decision" = 'rejected' AND "consumption_requests"."blocking_level" IS NOT NULL AND "consumption_requests"."blocking_rule" IS NOT NULL)
  ))
);
--> statement-breakpoint
CREATE TABLE "user_monthly_usage" (
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"consumed_units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_monthly_usage_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "user_monthly_usage_consumed_units_nonnegative" CHECK ("user_monthly_usage"."consumed_units" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_monthly_usage" ADD CONSTRAINT "account_monthly_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_requests" ADD CONSTRAINT "consumption_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_requests" ADD CONSTRAINT "consumption_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_monthly_usage" ADD CONSTRAINT "user_monthly_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consumption_requests_account_history_idx" ON "consumption_requests" USING btree ("account_id","created_at","request_id");--> statement-breakpoint
CREATE INDEX "consumption_requests_user_history_idx" ON "consumption_requests" USING btree ("account_id","user_id","created_at","request_id");