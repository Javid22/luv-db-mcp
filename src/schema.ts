/**
 * Schema documentation embedded into the MCP server as a resource.
 * Claude reads this to understand which tables to query for each topic.
 */
export const DB_SCHEMA_DOCS = `
# Luv.com MySQL Database Schema

The server has multiple databases. Use FULLY QUALIFIED names (database.table) in cross-db JOINs.
Run \`list_databases\` first to get the exact database names.

---

## Profile Database  (contains "profile" in its name)

### profile
Core user table. Most queries start here.
- ProfileId (PK), Name, Age, Gender, DateOfBirth
- ProfileStatus: 1=active, 2=suspended, 3=deleted
- MembershipStatus: 0=free, 1=paid
- MembershipType, ExpiryDate, ValidDays
- FupLimit (follow-up message limit for free users)
- PhotoAvailable, IdVerified, SelfieVerified
- Religion, MotherTongue, Community, Education, OccupationStatus
- LastOnline, LoginCount

### profile_payment
Lightweight membership summary — faster than joining payment tables.
- ProfileId (PK), MembershipStatus, MembershipType
- LastPayment, ExpiryDate, PaymentCount
- AutoRenewal, LastPaymentByAutoRenewal

### photo
Profile photos.
- ProfileId, IsPrimary, PhotoStatus
- TinyUrl, SmallUrl, MediumUrl, BigUrl
- DisplayOrder, IsSelfie

### partner_preference
User's match filter settings.
- ProfileId (PK), MinAge/MaxAge, MinHeight/MaxHeight
- Religion, MotherTongue, Community, Education, Occupation
- MemberSet (true = user customised their prefs)

### profile_interests
Hobbies/interests per profile.
- ProfileId (PK), PhysicalActivities, Sports, Music, Movies, Pets, etc.

### prompts
Audio and text prompts.
- ProfileId, Question (int code), Answer, Type (1=text, 2=audio), PromptStatus

### id_verification
ID verification results.
- ProfileId (PK), Status, VerificationType, NameSimilarityScore

### profile_solr
Denormalised search index — includes lists of who the user blocked/viewed/shortlisted.
- IBlocked, IReported, IShortlisted, IViewed (JSON arrays)
- BlockedMe, ReportedMe, ShortlistedMe, ViewedMe (JSON arrays)

### profile_deleted
Archive of deleted profiles (same schema as profile + DateDeleted, Reason).

### referral
Referral tracking.
- ProfileId, ReferrerId, ReferralLink

---

## Payment Database  (contains "payment" in its name)

### payment_success
**Primary table for paid order data.**
- ProfileId, OrderId (unique), ProductId
- AmountPaid, FinalAmount, PackageAmount
- AmountPaidDate, ExpiryDate
- Gateway (1=CCAvenue, etc.), PaymentType, PaymentMode
- InvoiceNumber, GatewayOrderId

### payment_attempt
All payment attempts including failed ones.
- ProfileId, OrderId (unique), Status (0=pending, 1=success, 2=failed)
- TotalAmount, Gateway, ProductId

### apple_payment
Apple in-app purchases.
- ProfileId, OrderId, TransactionId, AmountPaid, ExpiryDate

### payment_offer
Discount offers assigned to a profile.
- ProfileId (PK), OfferCode, OfferStartDate, OfferEndDate
- MemberDiscountPercentage, OfferAvailedStatus

### payment_recurring
Auto-renewal card data (card numbers are encrypted Blobs).
- ProfileId, OrderId, ProductId, AutoRenew

### autoRenew_charge / autoRenew_refund
Auto-renewal charge and refund history.

### online_refund / offline_refund
Refund records.

### payment_tax
GST/tax breakdown per transaction.
- OrderId, ProfileId, SGSTPercent, CGSTPercent, IGSTPercent

---

## Communication Database  (contains "comm" in its name)

### com_events
All chat/call events between pairs.
- PairId (FK to profile_pairs), CommData (JSON payload), CommDate
- OperationContextId (links to r_operation_contexts for event type)
- Visibility: 0=visible, 1=deleted

### profile_pairs
Maps pairs of users to a PairId.
- AutoId (PK = PairId), SenderId, ReceiverId
- unique(SenderId, ReceiverId)

### push_notification_success / push_notification_queue / push_notification_failure
Push notification delivery tracking.
- ProfileId, MessageType, RegisterId (device token), AttemptCount

### view_logs
Who viewed whose profile.
- ProfileId (viewed), ViewerId, DateViewed, PageSource

### cron_logs
Background job logs.

---

## Login Database  (contains "login" in its name)

### user_devices
Registered devices for push notifications.
- ProfileId, DeviceId, RegisterId (push token)
- AppType (1=Android, 2=iOS), AppVersion
- NotificationEnabled

### login_log
Full login history.
- ProfileId, LoggedInAt, ClientIp, AppType, AppVersion, DeviceDetails

---

## Common Query Patterns

### Is a profile paid? Get their order ID:
\`\`\`sql
SELECT p.ProfileId, p.Name, p.MembershipStatus, p.ExpiryDate,
       ps.OrderId, ps.AmountPaid, ps.AmountPaidDate, ps.ProductId
FROM <profileDb>.profile p
LEFT JOIN <paymentDb>.payment_success ps ON p.ProfileId = ps.ProfileId
WHERE p.ProfileId = 123456
ORDER BY ps.AmountPaidDate DESC
LIMIT 1;
\`\`\`

### Quick membership check (no JOIN needed):
\`\`\`sql
SELECT ProfileId, MembershipStatus, MembershipType, ExpiryDate, PaymentCount
FROM <profileDb>.profile_payment
WHERE ProfileId = 123456;
\`\`\`

### Chat history between two profiles:
\`\`\`sql
SELECT ce.AutoId, ce.CommData, ce.CommDate, ce.OperationContextId
FROM <commDb>.com_events ce
JOIN <commDb>.profile_pairs pp ON ce.PairId = pp.AutoId
WHERE (pp.SenderId = 111 AND pp.ReceiverId = 222)
   OR (pp.SenderId = 222 AND pp.ReceiverId = 111)
ORDER BY ce.CommDate DESC
LIMIT 50;
\`\`\`

### Payment history for a profile:
\`\`\`sql
SELECT OrderId, AmountPaid, AmountPaidDate, ExpiryDate, ProductId, Gateway
FROM <paymentDb>.payment_success
WHERE ProfileId = 123456
ORDER BY AmountPaidDate DESC;
\`\`\`

### Get profile photos:
\`\`\`sql
SELECT AutoId, MediumUrl, IsPrimary, PhotoStatus, DisplayOrder
FROM <profileDb>.photo
WHERE ProfileId = 123456
ORDER BY IsPrimary DESC, DisplayOrder ASC;
\`\`\`

### Devices registered for a profile (for push notifications):
\`\`\`sql
SELECT DeviceId, AppType, AppVersion, NotificationEnabled, DateUpdated
FROM <loginDb>.user_devices
WHERE ProfileId = 123456;
\`\`\`
`;
