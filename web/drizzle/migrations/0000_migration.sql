
-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Settings
CREATE TABLE public.settings (
  user_id uuid PRIMARY KEY,
  strategy text NOT NULL DEFAULT 'theory' CHECK (strategy IN ('theory','equity')),
  default_mode text NOT NULL DEFAULT 'suggest' CHECK (default_mode IN ('suggest','auto')),
  autoplay_confirmed_at timestamptz,
  nickname text NOT NULL DEFAULT 'hero',
  buy_in numeric NOT NULL DEFAULT 200,
  small_blind numeric NOT NULL DEFAULT 1,
  big_blind numeric NOT NULL DEFAULT 2,
  extension_connected boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.settings FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Tables
CREATE TABLE public.tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  pokernow_url text NOT NULL,
  game_id text,
  nickname text,
  is_demo boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','watching','suggesting','autoplay')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tables TO authenticated;
GRANT ALL ON public.tables TO service_role;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tables" ON public.tables FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Opponents
CREATE TABLE public.opponents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  player_id text NOT NULL,
  display_name text NOT NULL,
  is_account boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opponents TO authenticated;
GRANT ALL ON public.opponents TO service_role;
ALTER TABLE public.opponents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own opponents" ON public.opponents FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Hands
CREATE TABLE public.hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  hand_number int NOT NULL,
  board text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hands TO authenticated;
GRANT ALL ON public.hands TO service_role;
ALTER TABLE public.hands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own hands" ON public.hands FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.hand_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  hand_id uuid NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  opponent_id uuid NOT NULL REFERENCES public.opponents(id) ON DELETE CASCADE,
  seat int NOT NULL,
  stack numeric NOT NULL DEFAULT 0,
  won numeric NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hand_players TO authenticated;
GRANT ALL ON public.hand_players TO service_role;
ALTER TABLE public.hand_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own hand_players" ON public.hand_players FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  hand_id uuid NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  seq int NOT NULL,
  actor text NOT NULL,
  street text NOT NULL CHECK (street IN ('preflop','flop','turn','river')),
  action text NOT NULL CHECK (action IN ('fold','check','call','bet','raise')),
  amount numeric,
  facing text NOT NULL DEFAULT 'none' CHECK (facing IN ('blind','raise','bet','none'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.actions TO authenticated;
GRANT ALL ON public.actions TO service_role;
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own actions" ON public.actions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.showdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  hand_id uuid NOT NULL REFERENCES public.hands(id) ON DELETE CASCADE,
  opponent_id uuid NOT NULL REFERENCES public.opponents(id) ON DELETE CASCADE,
  cards text[] NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.showdowns TO authenticated;
GRANT ALL ON public.showdowns TO service_role;
ALTER TABLE public.showdowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own showdowns" ON public.showdowns FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  hand_id uuid REFERENCES public.hands(id) ON DELETE CASCADE,
  street text NOT NULL,
  suggested_action text NOT NULL CHECK (suggested_action IN ('fold','check','call','bet','raise')),
  size numeric,
  reason text NOT NULL,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  accepted text NOT NULL DEFAULT 'pending' CHECK (accepted IN ('pending','taken','overridden','ignored')),
  actual_action text,
  actual_size numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suggestions TO authenticated;
GRANT ALL ON public.suggestions TO service_role;
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own suggestions" ON public.suggestions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Demo seed for a user's workspace
CREATE OR REPLACE FUNCTION public.seed_demo_workspace(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid; o_ayush uuid; o_helo uuid; o_river uuid; h uuid; i int; s int;
  boards text[][] := ARRAY[
    ARRAY['Ks','7d','2c','9h','4s'], ARRAY['Qh','Jh','5c','2d','8s'], ARRAY['Ad','8c','3s','3h','Tc'],
    ARRAY['9s','6s','2h','Kd','Qc'], ARRAY['Tc','Td','4h','7s','Ac'], ARRAY['Jc','8d','6h','5s','2s'],
    ARRAY['As','Kc','7h','7c','3d'], ARRAY['5d','4d','3c','Jh','9c'], ARRAY['Qs','9d','2s','6c','Kh'],
    ARRAY['8h','7c','2d','Ah','Js'], ARRAY['Kh','Td','6s','3c','5h'], ARRAY['Ac','Qd','9c','4d','2h']];
  heros text[][] := ARRAY[
    ARRAY['Ah','Kd'], ARRAY['Tc','Ts'], ARRAY['Kh','Qh'], ARRAY['Ac','5c'], ARRAY['9d','9c'], ARRAY['As','Jd'],
    ARRAY['Qc','Qd'], ARRAY['6h','6d'], ARRAY['Ah','Qc'], ARRAY['Kc','Jc'], ARRAY['Ad','Td'], ARRAY['8s','8c']];
  acc text; act text; asize numeric; net numeric;
BEGIN
  INSERT INTO tables(user_id, pokernow_url, game_id, nickname, is_demo, status, last_seen_at)
  VALUES (_uid, 'https://www.pokernow.club/games/demo-table', 'demo-table', 'Demo table', true, 'suggesting', now())
  RETURNING id INTO t;

  INSERT INTO opponents(user_id, player_id, display_name, is_account, notes, first_seen, last_seen)
  VALUES (_uid, 'pn_ayush', 'Ayush', true, 'Calls down light. Value bet thinner, bluff less.', now() - interval '3 days', now())
  RETURNING id INTO o_ayush;
  INSERT INTO opponents(user_id, player_id, display_name, is_account, notes, first_seen, last_seen)
  VALUES (_uid, 'pn_helo', 'helo', true, 'Very tight. Respect raises.', now() - interval '3 days', now())
  RETURNING id INTO o_helo;
  INSERT INTO opponents(user_id, player_id, display_name, is_account, notes, first_seen, last_seen)
  VALUES (_uid, 'guest_riverboat', 'riverboat', false, 'Guest. Raises wide, barrels often.', now() - interval '2 days', now())
  RETURNING id INTO o_river;

  FOR i IN 1..12 LOOP
    net := CASE WHEN i % 3 = 0 THEN -18 WHEN i % 2 = 0 THEN 24 ELSE 11 END;
    INSERT INTO hands(user_id, table_id, hand_number, board, started_at, raw)
    VALUES (_uid, t, 100 + i, boards[i:i][1:5], now() - ((13 - i) * interval '6 minutes'),
      jsonb_build_object('hero_cards', to_jsonb(heros[i:i][1:2]), 'hero_net', net, 'pot', 40 + i * 3))
    RETURNING id INTO h;
    -- flatten 2D slices
    UPDATE hands SET board = ARRAY(SELECT unnest(boards[i:i][1:5])),
      raw = raw || jsonb_build_object('hero_cards', to_jsonb(ARRAY(SELECT unnest(heros[i:i][1:2]))))
      WHERE id = h;

    INSERT INTO hand_players(user_id, hand_id, opponent_id, seat, stack, won) VALUES
      (_uid, h, o_ayush, 2, 200 - i * 2, CASE WHEN i % 3 = 0 THEN 30 ELSE 0 END),
      (_uid, h, o_helo, 4, 210 + i, CASE WHEN i = 5 THEN 22 ELSE 0 END),
      (_uid, h, o_river, 6, 180 + (i % 4) * 15, CASE WHEN i % 4 = 0 THEN 26 ELSE 0 END);

    s := 0;
    -- preflop
    s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,'hero','preflop','raise',6,'blind');
    s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_ayush::text,'preflop','call',6,'raise');
    s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_helo::text,'preflop', CASE WHEN i = 5 THEN 'call' ELSE 'fold' END, CASE WHEN i = 5 THEN 6 END,'raise');
    IF i % 3 <> 0 THEN
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_river::text,'preflop','raise',18,'raise');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,'hero','preflop','call',18,'raise');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_ayush::text,'preflop','call',18,'raise');
    ELSE
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_river::text,'preflop','call',6,'raise');
    END IF;
    -- flop
    IF i % 3 <> 0 THEN
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,'hero','flop','check',NULL,'none');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_ayush::text,'flop','check',NULL,'none');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_river::text,'flop','bet',30,'none');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,'hero','flop', CASE WHEN i % 2 = 0 THEN 'call' ELSE 'fold' END, CASE WHEN i % 2 = 0 THEN 30 END,'bet');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_ayush::text,'flop','call',30,'bet');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_river::text,'turn','bet',60,'none');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_ayush::text,'turn','call',60,'bet');
    ELSE
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,'hero','flop','bet',12,'none');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_ayush::text,'flop','call',12,'bet');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_river::text,'flop','raise',40,'bet');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,'hero','flop','fold',NULL,'raise');
      s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_ayush::text,'flop','call',40,'raise');
    END IF;
    s := s + 1; INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES (_uid,h,s,o_ayush::text,'river','call',80,'bet');

    IF i % 2 = 0 THEN
      INSERT INTO showdowns(user_id, hand_id, opponent_id, cards) VALUES (_uid, h, o_ayush, ARRAY['7s','6c']);
    END IF;
    IF i % 4 = 0 THEN
      INSERT INTO showdowns(user_id, hand_id, opponent_id, cards) VALUES (_uid, h, o_river, ARRAY['Js','3h']);
    END IF;

    acc := CASE WHEN i IN (3,7,10) THEN 'overridden' WHEN i = 9 THEN 'ignored' ELSE 'taken' END;
    IF i % 3 <> 0 THEN
      act := CASE WHEN acc = 'overridden' THEN 'fold' ELSE 'call' END;
      INSERT INTO suggestions(user_id, table_id, hand_id, street, suggested_action, size, reason, confidence, accepted, actual_action, created_at)
      VALUES (_uid, t, h, 'flop', 'call', 30, 'riverboat bets wide here; your hand is ahead of their barrel range', 58 + i, acc,
        CASE WHEN acc = 'ignored' THEN NULL ELSE act END, now() - ((13 - i) * interval '6 minutes'));
    ELSE
      INSERT INTO suggestions(user_id, table_id, hand_id, street, suggested_action, size, reason, confidence, accepted, actual_action, actual_size, created_at)
      VALUES (_uid, t, h, 'flop', 'bet', 12, 'Range c-bet on a dry board; small size keeps Ayush calling', 64, acc,
        CASE WHEN acc = 'overridden' THEN 'check' WHEN acc = 'taken' THEN 'bet' END,
        CASE WHEN acc = 'taken' THEN 12 END, now() - ((13 - i) * interval '6 minutes'));
    END IF;
  END LOOP;

  -- Live hand on the flop
  INSERT INTO hands(user_id, table_id, hand_number, board, started_at, raw)
  VALUES (_uid, t, 113, ARRAY['Kd','7c','2h'], now(),
    jsonb_build_object('hero_cards', jsonb_build_array('Ah','Kc'), 'pot', 36, 'live', true, 'street', 'flop', 'hero_stack', 194))
  RETURNING id INTO h;
  INSERT INTO hand_players(user_id, hand_id, opponent_id, seat, stack, won) VALUES
    (_uid, h, o_ayush, 2, 182, 0), (_uid, h, o_helo, 4, 222, 0), (_uid, h, o_river, 6, 210, 0);
  INSERT INTO actions(user_id,hand_id,seq,actor,street,action,amount,facing) VALUES
    (_uid,h,1,'hero','preflop','raise',6,'blind'),
    (_uid,h,2,o_ayush::text,'preflop','call',6,'raise'),
    (_uid,h,3,o_helo::text,'preflop','fold',NULL,'raise'),
    (_uid,h,4,o_river::text,'preflop','call',6,'raise');
  INSERT INTO suggestions(user_id, table_id, hand_id, street, suggested_action, size, reason, confidence)
  VALUES (_uid, t, h, 'flop', 'bet', 24, 'Range c-bet, dry board. Bet 66% pot — Ayush calls wide, riverboat folds this texture often.', 71);
END $$;
REVOKE EXECUTE ON FUNCTION public.seed_demo_workspace(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reset_demo_workspace()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  DELETE FROM tables WHERE user_id = auth.uid() AND is_demo;
  DELETE FROM opponents WHERE user_id = auth.uid() AND player_id IN ('pn_ayush','pn_helo','guest_riverboat');
  PERFORM seed_demo_workspace(auth.uid());
END $$;
REVOKE EXECUTE ON FUNCTION public.reset_demo_workspace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_demo_workspace() TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles(id, display_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO settings(user_id, nickname) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', 'hero'));
  PERFORM seed_demo_workspace(NEW.id);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
