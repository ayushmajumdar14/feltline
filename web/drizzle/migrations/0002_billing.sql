-- Paid plans. Authenticated users can read their row; only the service role can write
-- (checkout + Stripe webhooks). Do not put plan flags on profiles — users can update that table.

CREATE TABLE IF NOT EXISTS public.billing (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'monthly', 'yearly', 'lifetime')),
  plan_status text NOT NULL DEFAULT 'none' CHECK (plan_status IN ('none', 'active', 'canceled', 'past_due')),
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing TO authenticated;
GRANT ALL ON public.billing TO service_role;
ALTER TABLE public.billing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own billing read" ON public.billing;
CREATE POLICY "own billing read" ON public.billing FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO public.billing (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles(id, display_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO settings(user_id, nickname) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', 'hero'));
  INSERT INTO billing(user_id) VALUES (NEW.id);
  PERFORM seed_demo_workspace(NEW.id);
  RETURN NEW;
END $$;
