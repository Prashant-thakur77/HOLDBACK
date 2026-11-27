-- Rows a fresh project needs before the first event arrives. No sample data:
-- holds, evidence and profiles only ever come from the chain and the agent.
-- Safe to run more than once.

-- Today's counters, so the landing page reads zeros instead of an empty set.
insert into public.metrics_daily (day)
values ((now() at time zone 'utc')::date)
on conflict (day) do nothing;

-- The static blocklists the agent refreshes. `refreshed_at` starts at the
-- epoch and `entries` at 0: nothing has been downloaded yet, and the first
-- refresh run treats every list as stale.
insert into public.blocklist_meta (list, entries, refreshed_at, source_url) values
  ('phantom', 0, 'epoch',
   'https://raw.githubusercontent.com/phantom/blocklist/master/blocklist.yaml'),
  ('scamsniffer', 0, 'epoch',
   'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json'),
  ('metamask', 0, 'epoch',
   'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json'),
  ('ofac', 0, 'epoch',
   'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_SOL.txt')
on conflict (list) do nothing;
