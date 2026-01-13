# Multi-User Authentication & Token System

**GitHub Issue:** [#6](https://github.com/RazK/HeroMaker/issues/6)

## Overview

Implement multi-user support with authentication, token-based creation costs, and access control in **phased milestones**. We start simple and build incrementally.

## Goals

- Users can sign up/login with username/password (Google OAuth in future milestone)
- Token-based system for hero creation (starting with coupon codes, payments later)
- Access control: viewing is free, downloads require login, creation requires tokens

## Simplified Database Schema (MVP)

**Tables we'll use:**

1. **Users** (modify existing): Add `tokens` column (Integer, default 0)
2. **Coupons** (new): Code, token_amount, expires_at, is_active
3. **CouponRedemptions** (new): Track which users redeemed which coupons (single-use-per-user)

**Tables we'll skip for MVP:**

- ~~TokenTransactions~~ - Audit trail can be added later. For MVP, we just track balance.

### Database Schema Details

**Users Table (modify existing)**

- Add `tokens = Column(Integer, default=0)` column
- `password_hash`, `username`, `email` already exist
- Ensure `username` has uniqueness constraint

**Coupons Table (new)**

- `id` (String, PK)
- `code` (String, unique, indexed) - Format: "HERO-XXXXXX"
- `token_amount` (Integer)
- `expires_at` (DateTime, nullable)
- `is_active` (Boolean, default True)
- `created_at`, `updated_at`

**CouponRedemptions Table (new)**

- `id` (String, PK)
- `coupon_id` (String, FK)
- `user_id` (String, FK)
- `redeemed_at` (DateTime)
- Unique constraint: (coupon_id, user_id) - ensures single-use-per-user

## Token Cost Configuration

Add to `backend/app/config/steps.py`:

```python
STEPS = [
    {"name": "image_processing", "token_cost": 0, ...},
    {"name": "chatgpt_render", "token_cost": 2, ...},
    {"name": "meshy_3d", "token_cost": 5, ...},
    {"name": "meshy_rig", "token_cost": 2, ...},
    {"name": "convert_vrm", "token_cost": 1, ...},
    {"name": "complete", "token_cost": 0, ...},
]
# Total: 10 tokens per creation (adjustable)
```

## Implementation Milestones

### Milestone 1: Basic Authentication Infrastructure

**Goal**: Users can sign up and log in with username/password

**Backend:**

- Add password hashing (bcrypt) to User model
- Implement JWT token generation/verification
- Create auth endpoints: signup, login, logout, /me
- Update `get_current_user` to use JWT instead of debug user
- Add dependencies: `python-jose`, `bcrypt`

**Files to modify:**

- `backend/app/services/auth.py` - Password hashing, JWT functions
  - `hash_password(password: str) -> str`
  - `verify_password(plain: str, hashed: str) -> bool`
  - `create_access_token(user_id: str) -> str`
  - `verify_access_token(token: str) -> Optional[str]`
  - `get_current_user(db, token: Optional[str]) -> User` (updated to use JWT)
- `backend/app/api/auth.py` (new) - Auth endpoints
- `backend/app/schemas/auth.py` (new) - Auth schemas (SignupRequest, LoginRequest, UserResponse)
- `backend/app/config/settings.py` - Add JWT_SECRET_KEY, JWT_ALGORITHM, JWT_EXPIRATION_HOURS
- `backend/requirements.txt` - Add `python-jose[cryptography]`, `bcrypt`

**Frontend:**

- Create AuthModal component (signup/login forms)
- Create HeaderAuth component (shows login button / user menu)
- Add auth state management (localStorage for JWT)
- Update API client to include JWT in requests
- Basic error handling for 401 responses

**Files to modify:**

- `frontend/src/components/AuthModal.tsx` (new) - Signup/login UI
- `frontend/src/components/HeaderAuth.tsx` (new) - Header with auth
- `frontend/src/api/client.ts` - Add auth methods, JWT handling
- `frontend/src/App.tsx` - Add auth state management, HeaderAuth component

**Database:**

- Ensure `users.username` has uniqueness constraint
- Ensure `password_hash` column exists

**Acceptance Criteria:**

- Users can create accounts with username, email, password
- Users can log in and receive JWT token
- Authenticated requests work, unauthenticated requests return 401
- Token stored in localStorage, persists across page refreshes

---

### Milestone 2: Token Balance & Coupon System

**Goal**: Users have token balances and can redeem coupon codes

**Backend:**

- Add `tokens` column to User model (Integer, default 0)
- Create Coupon and CouponRedemption models
- Create coupon redemption endpoint (`POST /api/coupons/redeem`)
- Create token balance endpoint (`GET /api/tokens/balance`)
- Add token service functions: `add_tokens()`, `get_user_balance()`
- Create coupon creation script for testing

**Files to modify:**

- `backend/app/models.py` - Add tokens column, Coupon/CouponRedemption models
- `backend/app/services/tokens.py` (new) - Token management functions
- `backend/app/api/coupons.py` (new) - Coupon redemption endpoint
- `backend/app/api/tokens.py` (new) - Token balance endpoint
- `backend/scripts/create_coupon.py` (new) - Admin script to create coupons

**Frontend:**

- Display token balance in header (when logged in)
- Create CouponRedeem component/modal
- Add coupon redemption to user menu
- Update `/me` endpoint response to include token balance

**Files to modify:**

- `frontend/src/components/HeaderAuth.tsx` - Display token balance
- `frontend/src/components/CouponRedeem.tsx` (new) - Coupon UI
- `frontend/src/api/client.ts` - Add `getTokenBalance()`, `redeemCoupon(code)`

**Database Migration:**

- Add `tokens` column to users table
- Create coupons and coupon_redemptions tables

**Acceptance Criteria:**

- Users see token balance in header (starts at 0)
- Users can redeem coupon codes via UI
- Token balance updates after redemption
- Coupon codes enforce single-use-per-user
- Expired/inactive coupons are rejected

---

### Milestone 3: Token Deductions on Creation

**Goal**: Creating a hero costs tokens, deducted when pipeline starts

**Backend:**

- Add `token_cost` to each step in `steps.py` (placeholder costs)
- Calculate total creation cost (sum of step costs)
- Update `run_pipeline_sequential` to:
  - Check user has enough tokens
  - Deduct tokens when pipeline starts
  - Return error if insufficient balance
- Add token deduction service function: `deduct_tokens()`
- Update creation upload endpoint to require auth

**Files to modify:**

- `backend/app/config/steps.py` - Add token_cost to each step
- `backend/app/services/pipeline.py` - Add token deduction logic
- `backend/app/services/tokens.py` - Add `deduct_tokens()` function
- `backend/app/api/creations.py` - Require auth, check tokens before starting

**Frontend:**

- Show creation cost and user balance before upload
- Disable upload if insufficient tokens
- Show clear error message if token check fails
- Display token cost in UI

**Files to modify:**

- `frontend/src/components/FileUpload.tsx` - Token balance check, show cost
- `frontend/src/components/CreationGallery.tsx` - Token balance warnings

**Acceptance Criteria:**

- Users cannot start creation if balance < cost
- Tokens are deducted when pipeline starts (not per-step)
- Clear error messages for insufficient tokens
- Token balance updates after deduction

---

### Milestone 4: Access Control (Download Requires Auth)

**Goal**: Viewing is free, downloading requires authentication

**Backend:**

- Update file serving endpoint:
  - Viewing (GET for images/models in preview): Public (no auth)
  - Download (explicit download action): Require auth
  - Use separate endpoint: `GET /api/files/{user_id}/{creation_id}/{filename}/download`
- Update creation endpoints:
  - `GET /api/creations/{id}`: Public (no auth)
  - `GET /api/creations/`: Public list, but filter by user when authenticated
  - `PATCH/DELETE`: Require auth + ownership verification
  - `POST /upload`, `POST /run`: Already require auth from Milestone 3

**Files to modify:**

- `backend/app/api/files.py` - Add download endpoint (auth required)
- `backend/app/api/creations.py` - Update access control (public viewing, auth for edits)

**Frontend:**

- Show login prompt when trying to download while not logged in
- Make download button check auth state
- Allow viewing creations/gallery without login
- Show "Log in to download" message

**Files to modify:**

- `frontend/src/components/DownloadButton.tsx` - Auth check, login prompt
- `frontend/src/components/CreationGallery.tsx` - Show login prompt for downloads

**Acceptance Criteria:**

- Anyone can view creations and preview files
- Downloads require login
- Creation/editing requires login (from M3)
- Clear messaging about what requires auth

---

### Milestone 5: Google OAuth Integration (Future)

**Goal**: Users can sign up/login with Google accounts

**Backend:**

- Add Google OAuth client configuration
- Create OAuth callback endpoint
- Handle Google user creation/linking
- Support both password and Google auth on same account

**Frontend:**

- Add "Sign in with Google" button
- Handle OAuth flow redirects
- Link Google accounts to existing accounts (optional)

**Acceptance Criteria:**

- Users can sign up with Google
- Users can log in with Google
- Google users have same token system
- Existing password users can link Google account

---

### Milestone 6: Payment Integration (Future)

**Goal**: Real payment processing for token purchases

**Backend:**

- Integrate payment provider (Stripe/PayPal/etc)
- Create purchase endpoints
- Webhook handling for payment confirmation
- Add tokens after successful payment

**Frontend:**

- Payment UI/checkout flow
- Token purchase options
- Payment history

---

## Data Migration

Create `backend/migrate_to_multiuser.py`:

- Create admin user account
- Migrate creations from `debug-user-uuid` to admin user
- Set admin with initial token balance for testing

## API Endpoints Summary

**New Endpoints:**

- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login (returns JWT)
- `POST /api/auth/logout` - Logout (client-side)
- `GET /api/auth/me` - Get current user info + token balance
- `POST /api/coupons/redeem` - Redeem coupon code
- `GET /api/tokens/balance` - Get token balance

**Modified Endpoints:**

- `POST /api/creations/upload` - Require auth, deduct tokens
- `GET /api/creations/{id}` - Public viewing (no auth)
- `GET /api/creations/` - Public list (filter by user when auth)
- `PATCH /api/creations/{id}` - Require auth + ownership
- `DELETE /api/creations/{id}` - Require auth + ownership
- `GET /api/files/{user_id}/{creation_id}/{filename}` - Public viewing
- `GET /api/files/{user_id}/{creation_id}/{filename}/download` - Require auth

## Security Considerations

1. **Password Storage**: Use bcrypt with salt rounds (12+)
2. **JWT Security**:
   - Store secret key in environment variable
   - Set reasonable expiration (24 hours)
   - Include user_id in token payload
3. **Input Validation**: Validate all inputs (username format, email format, password strength)
4. **Rate Limiting**: Consider rate limiting for login/signup (future)
5. **SQL Injection**: Use SQLAlchemy ORM (already in place)
6. **File Access**: Validate file paths, ensure user can only access their own files (or public files)

## Files Summary

### Backend Files to Create/Modify

- `backend/app/models.py` - Add tokens column, Coupon/CouponRedemption models
- `backend/app/services/auth.py` - Password hashing, JWT functions
- `backend/app/api/auth.py` (new) - Auth endpoints
- `backend/app/schemas/auth.py` (new) - Auth schemas
- `backend/app/services/tokens.py` (new) - Token management
- `backend/app/api/coupons.py` (new) - Coupon redemption
- `backend/app/api/tokens.py` (new) - Token balance endpoint
- `backend/app/api/creations.py` - Add auth requirements, token checks
- `backend/app/api/files.py` - Add download endpoint (auth required)
- `backend/app/services/pipeline.py` - Add token deduction
- `backend/app/config/steps.py` - Add token_cost to steps
- `backend/app/config/settings.py` - JWT configuration
- `backend/scripts/create_coupon.py` (new) - Admin script to create coupons
- `backend/migrate_to_multiuser.py` (new) - Data migration script
- `backend/requirements.txt` - Add dependencies

### Frontend Files to Create/Modify

- `frontend/src/components/AuthModal.tsx` (new) - Signup/login UI
- `frontend/src/components/HeaderAuth.tsx` (new) - Header with auth/tokens
- `frontend/src/components/CouponRedeem.tsx` (new) - Coupon UI
- `frontend/src/api/client.ts` - Add auth methods, JWT handling
- `frontend/src/components/FileUpload.tsx` - Token balance check
- `frontend/src/components/DownloadButton.tsx` - Auth check
- `frontend/src/components/CreationGallery.tsx` - Access control UI
- `frontend/src/App.tsx` - Auth state management

## Testing & Debugging

**Coupon Creation Script:**

- `backend/scripts/create_coupon.py`
- Usage: `python scripts/create_coupon.py --code HERO-TEST123 --tokens 100 --expires 2024-12-31`


