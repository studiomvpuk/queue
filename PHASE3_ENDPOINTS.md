# Phase 3: API Endpoints Reference

## 1. Payments (Paystack)

### POST `/payments/paystack/initialize`
- **Auth:** Bearer JWT (user)
- **Body:**
  ```json
  {
    "purpose": "PRIORITY_SLOT",
    "locationId": "loc_xxx",
    "slotStart": "2026-04-15T14:00:00Z",
    "bookingId": "optional-booking-id"
  }
  ```
- **Response:** `{ authorizationUrl, reference, paymentId }`
- **Amount:** Category-based pricing (₦200–₦1000), free for isAccessibility=true users

### POST `/payments/paystack/webhook`
- **Auth:** Public (verifies X-Paystack-Signature: HMAC-SHA512)
- **Event:** `charge.success` triggers booking atomically
- **Idempotent:** By reference
- **WS Event:** `payment:success` emitted to user

### GET `/payments/me`
- **Auth:** Bearer JWT (user)
- **Response:** Array of payment records (last 20 by default)

---

## 2. Priority Slots & Accessibility

### POST `/users/me/accessibility`
- **Auth:** Bearer JWT (user)
- **Body:**
  ```json
  {
    "isAccessibility": true,
    "proofDocumentUrl": "optional-url"
  }
  ```
- **Effect:** Logs audit event, marks user as eligible for free priority slots

### GET `/locations/:id`
- **New fields:** `priorityEnabled: boolean`, `priorityPrice: number_in_kobo`
- **Priority cap:** 20% of location capacity per day
- **Queue logic:** Priority bookings skip ahead of same-slot non-priority bookings

---

## 3. Virtual Calls (Daily.co)

### POST `/virtual-calls/rooms`
- **Auth:** Bearer JWT (STAFF/MANAGER/OWNER only)
- **Body:** `{ bookingId }`
- **Response:** `{ roomUrl }` (expires in 1 hour)
- **Room name:** `queuease-{booking.code}`
- **WS Event:** `virtual:room-ready` sent to user

### Location Config
- Add `virtualEnabled: boolean` (default: false) to Location model
- Booking served-transition auto-creates room if virtualEnabled

---

## 4. Enterprise API (OAuth 2.0)

### POST `/admin/api-clients`
- **Auth:** Bearer JWT (ADMIN only)
- **Body:**
  ```json
  {
    "name": "Third-party Integrator",
    "scopes": ["bookings:read", "locations:read"]
  }
  ```
- **Response:** `{ clientId, clientSecret }` **RETURNED ONCE ONLY**
- **Storage:** clientSecretHash (argon2) stored in DB

### POST `/oauth/token`
- **Auth:** Public
- **Rate limit:** 10/min
- **Body:**
  ```json
  {
    "grant_type": "client_credentials",
    "client_id": "client_xxx",
    "client_secret": "secret_xxx"
  }
  ```
- **Response:** `{ access_token, token_type: "Bearer", expires_in: 1800 }`
- **Token TTL:** 30 minutes, type: 'client'

### GET `/api/v1/api/locations`
- **Auth:** Bearer JWT or Client JWT
- **Guard:** `ApiClientAuthGuard` + `@RequireScopes('locations:read')`
- **Note:** Example enterprise endpoint; expand as needed

---

## 5. Webhooks (for API Clients)

### POST `/webhooks`
- **Auth:** Bearer Client JWT
- **Guard:** `ApiClientAuthGuard`
- **Body:**
  ```json
  {
    "url": "https://example.com/webhook",
    "events": ["booking.created", "booking.served"]
  }
  ```
- **Response:** `{ id, url, events, secret }` (secret returned once only)

### DELETE `/webhooks/:id`
- **Auth:** Bearer Client JWT
- **Effect:** Soft-delete webhook (isActive=false)

### GET `/webhooks/me`
- **Auth:** Bearer Client JWT
- **Response:** Array of webhooks for authenticated client

### Dispatch Mechanism
- **Trigger:** BookingsService state changes
- **Signature:** HMAC-SHA256 with `X-QueueEase-Signature` header
- **Payload:** `{ event, data, timestamp }`
- **Queue:** BullMQ-backed with 3 retries, exponential backoff (2s → 4s → 8s)
- **Timeout:** 10 seconds per dispatch

---

## 6. USSD (Feature-Flagged)

### POST `/ussd/termii`
- **Auth:** Public (verifies X-Termii-Signature)
- **Feature flag:** `USSD_ENABLED` env var
- **State machine:** 4-step flow (category → location → slot → confirm)
- **State storage:** Redis, TTL 5 minutes per phone number
- **Response:** USSD menu text (`CON` or `END` prefix)

**State Flow:**
1. **Category** → User selects service type
2. **Location** → Filter by category, user selects branch
3. **Slot** → Show available time slots
4. **Confirm** → Create booking, return confirmation code via SMS

---

## Environment Variables (Phase 3)

```bash
# Paystack
PAYSTACK_SECRET_KEY=sk_live_xxx
PAYSTACK_WEBHOOK_SECRET=webhook_secret_xxx

# Daily.co
DAILY_API_KEY=api_key_xxx

# USSD
USSD_ENABLED=false  # Set to 'true' to enable

# JWT for client auth
JWT_ACCESS_SECRET=... (min 32 chars)
```

---

## Schema Updates

### Location
```prisma
priorityEnabled Boolean @default(true)
virtualEnabled  Boolean @default(false)
```

### Webhook (new)
```prisma
model Webhook {
  id          String
  apiClientId String
  url         String
  secret      String
  events      String[]
  isActive    Boolean
  createdAt   DateTime
  updatedAt   DateTime
}
```

### ApiClient
```prisma
webhooks Webhook[]  // Relation added
```

---

## Security & Audit

- **Webhook signatures:** Verified BEFORE parsing body
- **Secrets:** Never logged; returned once only (or hashed)
- **Rate limits:** Aggressive on `/oauth/token` (10/min global, per-client via Redis override)
- **Audit trail:** Every payment, webhook creation, API client action logged
- **Accessibility:** Free priority for `isAccessibility=true` users; proof document URL stored for review

---

## Trade-offs & Notes

1. **Webhook Dispatch:** BullMQ + Redis ensures durability across restarts
2. **Priority Capacity:** Enforced at booking time; no overbooking
3. **Virtual Room Expiry:** Hard 1-hour TTL at Daily.co; clients should refresh if needed
4. **Client Secrets:** Single-use return pattern prevents retrieval; clients must store securely
5. **USSD State:** TTL 5 min; user can restart by dialing again
6. **Accessibility Audit:** Current impl logs declaration; future: manual review workflow required
