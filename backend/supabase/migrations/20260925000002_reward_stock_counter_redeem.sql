-- Rewards are handed over at the counter: an admin looks the tourist up and
-- redeems on their behalf, which deducts the points and the stock together.
-- Tourists can no longer redeem on their own, so redeem_reward() goes away.

-- ---------------------------------------------------------------------------
-- 1. Stock (null = unlimited)
-- ---------------------------------------------------------------------------
alter table rewards add column if not exists stock integer
  check (stock is null or stock >= 0);

-- ---------------------------------------------------------------------------
-- 2. Redemption records: who handed it over, status, and a snapshot of the
--    reward name so history still reads after a reward is deleted
-- ---------------------------------------------------------------------------
alter table redemptions add column if not exists reward_name text;
alter table redemptions add column if not exists admin_id uuid references users (id) on delete set null;
alter table redemptions add column if not exists status text not null default 'completed'
  check (status in ('completed', 'cancelled'));
alter table redemptions add column if not exists cancelled_at timestamptz;
alter table redemptions add column if not exists cancelled_by uuid references users (id) on delete set null;
alter table redemptions add column if not exists cancel_reason text;

-- Deleting a reward used to delete every redemption of it (ON DELETE CASCADE),
-- erasing the points history of the people who redeemed it.
alter table redemptions alter column reward_id drop not null;
alter table redemptions drop constraint redemptions_reward_id_fkey;
alter table redemptions add constraint redemptions_reward_id_fkey
  foreign key (reward_id) references rewards (id) on delete set null;

update redemptions r set reward_name = w.name
from rewards w where w.id = r.reward_id and r.reward_name is null;

-- ---------------------------------------------------------------------------
-- 3. Counter redemption: points, stock and the record change together
-- ---------------------------------------------------------------------------
-- Error codes (mapped to HTTP statuses in adminRedemptions.routes.js):
--   US404 user not found, US403 account suspended/deleted, RW404 reward not
--   found, RW409 out of stock, PT402 not enough points.
drop function if exists redeem_reward(uuid, uuid);

create or replace function admin_redeem_reward(p_user_id uuid, p_reward_id uuid, p_admin_id uuid)
returns table (redemption_id uuid, new_balance integer, remaining_stock integer, reward_name text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_user users%rowtype;
  v_reward rewards%rowtype;
  v_balance integer;
  v_stock integer;
  v_id uuid;
begin
  select * into v_user from users where id = p_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'US404';
  end if;
  if v_user.deleted_at is not null or v_user.status <> 'active' then
    raise exception 'account_inactive' using errcode = 'US403';
  end if;

  select * into v_reward from rewards where id = p_reward_id for update;
  if not found then
    raise exception 'reward_not_found' using errcode = 'RW404';
  end if;
  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'out_of_stock' using errcode = 'RW409';
  end if;
  if v_user.points_balance < v_reward.cost then
    raise exception 'insufficient_points' using errcode = 'PT402';
  end if;

  update users set points_balance = points_balance - v_reward.cost
  where id = p_user_id
  returning points_balance into v_balance;

  if v_reward.stock is not null then
    update rewards set stock = stock - 1 where id = p_reward_id returning stock into v_stock;
  end if;

  insert into redemptions (reward_id, reward_name, user_id, cost, admin_id)
  values (p_reward_id, v_reward.name, p_user_id, v_reward.cost, p_admin_id)
  returning id into v_id;

  return query select v_id, v_balance, v_stock, v_reward.name;
end;
$$;

-- Undo a redemption (e.g. handed over by mistake): refunds the points and puts
-- the item back in stock. The row stays, marked cancelled, so the history is
-- complete. Error codes: RD404 not found, RD409 already cancelled.
create or replace function admin_cancel_redemption(p_redemption_id uuid, p_admin_id uuid, p_reason text)
returns table (new_balance integer, user_id uuid)
language plpgsql
security definer set search_path = public
as $$
declare
  v_r redemptions%rowtype;
  v_balance integer;
begin
  select * into v_r from redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'redemption_not_found' using errcode = 'RD404';
  end if;
  if v_r.status = 'cancelled' then
    raise exception 'already_cancelled' using errcode = 'RD409';
  end if;

  update redemptions
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_admin_id, cancel_reason = p_reason
  where id = p_redemption_id;

  update users set points_balance = points_balance + v_r.cost
  where id = v_r.user_id
  returning points_balance into v_balance;

  if v_r.reward_id is not null then
    update rewards set stock = stock + 1 where id = v_r.reward_id and stock is not null;
  end if;

  return query select v_balance, v_r.user_id;
end;
$$;

revoke execute on function admin_redeem_reward(uuid, uuid, uuid) from public;
grant execute on function admin_redeem_reward(uuid, uuid, uuid) to service_role;
revoke execute on function admin_cancel_redemption(uuid, uuid, text) from public;
grant execute on function admin_cancel_redemption(uuid, uuid, text) to service_role;
