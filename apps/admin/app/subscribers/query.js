// THE subscriber row query, shared by the list page and the CSV export so
// the two can never disagree on what "donor" or "petitions" means.
//   donor     = the email belongs to a member with ≥1 recorded donation or a
//               subscription that is not canceled (Stripe webhook data)
//   petitions = comma-separated campaign slugs this email signed
//               (docs/systems/petition.md), oldest first
// Newest subscriber first; callers may append ' LIMIT n'.
export const SUBSCRIBER_ROWS_SQL = `
  SELECT s.email, s.first_name, s.last_name, s.address, s.zip, s.created_at::text AS created_at,
         EXISTS (
           SELECT 1 FROM members m
           WHERE m.email = s.email AND (
             EXISTS (SELECT 1 FROM donations d WHERE d.member_id = m.id)
             OR EXISTS (SELECT 1 FROM subscriptions x WHERE x.member_id = m.id AND x.status <> 'canceled')
           )
         ) AS donor,
         COALESCE((
           SELECT string_agg(p.petition, ', ' ORDER BY p.created_at)
           FROM petition_signatures p WHERE p.email = s.email
         ), '') AS petitions
  FROM subscribers s
  ORDER BY s.created_at DESC`;
