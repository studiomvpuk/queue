# Phase 3 Implementation Summary

## Overview
Complete Phase 3 feature set for QueueEase NestJS backend: Paystack payments, priority slots, virtual calls, enterprise API, webhooks, and USSD menus.

## Files Created/Modified

### Schema Updates
- **prisma/schema.prisma**
  - Added `Location.priorityEnabled` (default: true)
  - Added `Location.virtualEnabled` (default: false)
  - New `Webhook` model with foreign key to `ApiClient`
  - Extended `ApiClient` with `webhooks` relation

### Environment Validation
- **src/config/env.validation.ts**
  - Added `DAILY_API_KEY` (optional)
  - Added `USSD_ENABLED` (boolean, default: false)

### 1. Payments Module (`src/modules/payments/`)
**Files:**
- `pricing.ts` — Category-keyed pricing map (₦200–₦1000 in kobo)
- `dto/initialize-paystack.dto.ts` — Request validation
- `payments.service.ts` — Payment initialization & webhook handling
  - `initializePaystack()` — Creates Payment (status=initiated), calls Paystack API
  - `handlePaystackWebhook()` — HMAC-SHA512 verification, idempotent by reference
  - `getPaymentHistory()` — User payment records
- `payments.controller.ts` — 3 endpoints
  - POST `/payments/paystack/initialize` — Requires user JWT
  - POST `/payments/paystack/webhook` — Public, verifies X-Paystack-Signature
  - GET `/payments/me` — User history
- `payments.module.ts` — Registers PaymentsService with BookingsModule, QueuesModule

**Key Features:**
- Never logs raw card data
- Authorization URL not stored post-response
- Atomic booking creation on webhook success
- WS event emitted: `payment:success`

### 2. Priority Slots Module (`src/modules/priority-slots/`)
**Files:**
- `priority-slots.service.ts`
  - `canBookPriority()` — Checks 20% capacity cap per day
  - `setAccessibility()` — User self-declaration with audit
  - `computeQueuePosition()` — Priority-aware queue position calculation
- `priority-slots.controller.ts`
  - POST `/users/me/accessibility` — Boolean flag + optional proof document
- `priority-slots.module.ts` — Exports service for injection into BookingsService

**Key Features:**
- 20% cap enforced per location per day
- Accessibility users get free priority slots
- Priority bookings skip ahead of non-priority same-slot bookings
- Audit trail for accessibility declarations
- Returns `remainingSlots` in capacity check response

### 3. Virtual Calls Module (`src/modules/virtual-calls/`)
**Files:**
- `virtual-calls.service.ts`
  - `createVirtualRoom()` — Calls Daily.co API, returns roomUrl (1-hour expiry)
  - Room name format: `queuease-{booking.code}`
- `virtual-calls.controller.ts`
  - POST `/virtual-calls/rooms` — STAFF/MANAGER/OWNER only
- `virtual-calls.module.ts` — Connects to QueuesModule for WS events

**Key Features:**
- STAFF-only room creation
- Daily.co integration with DAILY_API_KEY
- Room expires 1 hour after creation
- WS event: `virtual:room-ready` sent to user
- Extensible: booking.metadata can store roomUrl (schema migration optional)

### 4. Enterprise API Module (`src/modules/api-clients/`)
**Files:**
- `api-clients.service.ts`
  - `createApiClient()` — Admin-only, returns clientId + clientSecret (once only)
  - `issueAccessToken()` — Validates credentials, issues 30-min JWT
  - `validateClientToken()` — Decodes and validates client JWT
- `api-client-auth.guard.ts`
  - `ApiClientAuthGuard` — Accepts user JWT or client JWT
  - `@RequireScopes()` decorator — Enforces scope requirements
- `api-clients.controller.ts`
  - POST `/admin/api-clients` — Create client (ADMIN only)
  - POST `/oauth/token` — Issue access token (public, 10/min rate limit)
- `api-clients.module.ts` — Provides JwtModule, exports service

**Key Features:**
- clientSecret returned once only; never retrievable
- 30-minute access token TTL
- Scope-based access control via decorator
- Aggressively rate-limited token endpoint (10/min global)
- Per-client rate limit override via Redis (not yet implemented but structure supports it)

### 5. Webhooks Module (`src/modules/webhooks/`)
**Files:**
- `webhook-dispatcher.service.ts`
  - `dispatchWebhook()` — Enqueues webhook job to BullMQ
  - `processWebhook()` — POSTs signed payload, retries with exponential backoff
  - Signature: HMAC-SHA256 of JSON payload
- `webhooks.service.ts`
  - `createWebhook()` — Returns secret (once only) for client verification
  - `deleteWebhook()` — Scope-checked
  - `getWebhooks()` — Client-scoped list
- `webhooks.controller.ts`
  - POST `/webhooks` — Create webhook (client auth required)
  - DELETE `/webhooks/:id` — Delete webhook
  - GET `/webhooks/me` — List client's webhooks
- `webhooks.module.ts` — Registers BullMQ queue, exports dispatcher

**Key Features:**
- BullMQ-backed with 3 retries (exponential backoff: 2s, 4s, 8s)
- 10-second timeout per dispatch
- Signature verification required by consuming apps
- Removed on completion (no persistence after success)
- Audit trail for webhook CRUD operations

### 6. USSD Module (`src/modules/ussd/`)
**Files:**
- `ussd.service.ts` — Feature-flagged state machine
  - `handleTermiiWebhook()` — Verifies signature, manages state transitions
  - 4-step flow: category → location → slot → confirm
  - Redis state storage: TTL 5 minutes per phone
- `ussd.controller.ts`
  - POST `/ussd/termii` — Public, verifies X-Termii-Signature
- `ussd.module.ts` — Connects PrismaModule + RedisModule

**Key Features:**
- Controlled by `USSD_ENABLED` env var (default: false)
- State machine returns USSD menu text (CON/END prefix)
- 5-minute state TTL; auto-cleanup via Redis
- Extensible: booking creation logic simplified for reference

## Integration Points

### BookingsService Injection
PrioritySlotsService should be injected into BookingsService for:
- Queue position calculation considering priority
- Capacity validation before booking creation

### QueuesGateway Integration
PaymentsService, VirtualCallsService emit WS events via QueuesGateway:
- `payment:success` — Notifies user of successful charge
- `virtual:room-ready` — Sends Daily.co room URL

### WebhookDispatcherService Integration
BookingsService calls `webhookDispatcher.dispatchWebhook(event, data)` on state transitions (e.g., CONFIRMED → SERVING).

## Database Migrations
After code deploy, run:
```bash
npx prisma migrate dev --name phase3_payments_webhooks_virtual
```

This creates:
- Location.priorityEnabled, Location.virtualEnabled columns
- Webhook table with foreign key to ApiClient
- ApiClient.webhooks relation

## Deployment Checklist

- [ ] Set `PAYSTACK_SECRET_KEY` and `PAYSTACK_WEBHOOK_SECRET` in prod env
- [ ] Set `DAILY_API_KEY` if using virtual calls
- [ ] Set `USSD_ENABLED=true` (or false) based on rollout plan
- [ ] Configure BullMQ Redis instance (separate from cache Redis)
- [ ] Test Paystack webhook delivery (setup tunnel for localhost dev)
- [ ] Test Daily.co room creation with test API key
- [ ] Seed test ApiClient records for enterprise tier
- [ ] Review audit logs for payment/webhook events

## Trade-offs

1. **Webhook Queue Durability:** BullMQ relies on external Redis; single-instance Redis is a SPOF. Use Redis Sentinel or cluster in production.

2. **Priority Capacity Calculation:** Enforced per-day; midnight boundary may cause brief overage if bookings created right at boundary.

3. **Virtual Room Expiry:** Hard 1-hour TTL at Daily.co; extending requires custom Daily.co webhook to refresh.

4. **Client Secrets:** Single-return pattern is secure but requires client to manage rotation (no built-in secret rotation yet).

5. **USSD State Machine:** Simplified for reference; production should validate phone number via Termii and link to User account.

6. **Accessibility Audit:** Current impl stores proof document URL; no automated review. Future: async workflow to verify documents.

## Testing Recommendations

- **Payments:** Mock Paystack API; test webhook signature verification
- **Priority Slots:** Verify 20% cap is enforced; test priority skip-ahead logic
- **Virtual Calls:** Mock Daily.co API; verify room expiry handling
- **API Clients:** Test token issuance, scope validation, rate limiting
- **Webhooks:** Verify BullMQ job creation, retry logic, signature generation
- **USSD:** Test state machine transitions; verify Redis cleanup

## Next Steps

1. Inject PrioritySlotsService into BookingsService
2. Integrate WebhookDispatcherService into BookingsService state transitions
3. Add VirtualCallsService call to serving-transition handler
4. Create migration script for production data (set priorityEnabled=true by default)
5. Build frontend forms for accessibility declaration + payment flow
6. Set up webhook test harness for enterprise partners
