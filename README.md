# HireKe - Job Platform with Recruiter Dashboard

A full-stack job platform where job seekers can search and apply for jobs, and recruiters can post jobs, manage applications, and upgrade to premium features.

## Setup Instructions

### 1. Install Dependencies

```bash
cd c:\Users\Denmo Sticker\Desktop\Hireke1
npm install
```

### 2. Configure Environment Variables

Edit `.env` file and update:
- `JWT_SECRET` - Change to a secure random string
- `PALPLUS_API_KEY`, `PALPLUS_CLIENT_ID`, `PALPLUS_SECRET_KEY` - PalPlus credentials for M-Pesa STK Push
- `PALPLUS_CALLBACK_SECRET` - HMAC secret for payment callbacks

For testing without real PalPlus calls, set `PALPLUS_MOCK=true`.

### 3. Start the Server

```bash
npm start
```

Server will run on `http://localhost:3000`

### 4. Access the Application

- **Job Seeker**: Open `http://localhost:3000/index.html`
- **Recruiter Dashboard**: Open `http://localhost:3000/recruiter-dashboard.html` (after login as recruiter)
- **Admin Dashboard**: Open `http://localhost:3000/admin-dashboard.html` (requires admin role)

## Features

### For Job Seekers
- Browse all approved job listings
- Save jobs for later
- Apply via email or company website
- Upload and scan CV with ATS scoring
- Track applications

### For Recruiters
- Sign up as recruiter (pending admin approval)
- Post unlimited jobs
- View job applications and applicant CVs
- Dashboard with analytics (views, applicants, shortlisted)
- Upgrade recruiter plans and add-ons with M-Pesa STK Push
- Feature jobs to appear at top of feed

### For Admins
- Approve/reject recruiter accounts
- Approve/reject job postings
- View all recruiters and jobs
- Manage the platform

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Jobs
- `GET /api/jobs` - Get all approved jobs
- `POST /api/jobs` - Post new job (recruiter)
- `PUT /api/jobs/:id` - Update job (recruiter)
- `DELETE /api/jobs/:id` - Delete job (recruiter)

### Recruiter Dashboard
- `GET /api/recruiter/dashboard` - Get dashboard stats
- `GET /api/recruiter/jobs-list` - Get recruiter's jobs
- `GET /api/recruiter/subscription` - Get subscription status
- `POST /api/recruiter/feature-job/:jobId` - Feature/unfeature job

### Admin
- `GET /api/admin/pending-recruiters` - Get pending recruiters
- `POST /api/admin/approve-recruiter/:id` - Approve recruiter
- `POST /api/admin/reject-recruiter/:id` - Reject recruiter
- `GET /api/admin/pending-jobs` - Get pending jobs
- `POST /api/admin/approve-job/:id` - Approve job
- `POST /api/admin/reject-job/:id` - Reject job

### Payments
- `GET /api/payments/catalog` - Get recruiter plans, add-ons, and verification plans
- `POST /api/payments/stk-push` - Start PalPlus M-Pesa STK Push
- `POST /api/payments/palplus/callback` - PalPlus callback handler

## Database Schema

### users
- id, email, password, name, role, status, company_name, company_url, verified_at, created_at

### jobs
- id, recruiter_id, title, location, salary_min, salary_max, description, requirements, job_type, deadline, status, featured, created_at

### applications
- id, job_id, applicant_email, applicant_name, cv_score, applied_at

### payments
- id, recruiter_id, amount, stripe_session_id, status, created_at

### subscriptions
- id, recruiter_id, plan_type, featured_jobs, expiry_date, active

## File Structure

```
hireke1/
├── index.html                 # Main job seeker page
├── recruiter-dashboard.html   # Recruiter dashboard UI
├── admin-dashboard.html       # Admin dashboard UI (to be created)
├── script_final.js            # Frontend logic for job seeker
├── recruiter-dashboard.js     # Frontend logic for recruiter
├── admin-dashboard.js         # Frontend logic for admin (to be created)
├── style.css                  # Styling
├── server.js                  # Express server entry point
├── database.js                # SQLite setup and schema
├── auth-routes.js             # Authentication endpoints
├── jobs-routes.js             # Job management endpoints
├── recruiter-routes.js        # Recruiter dashboard endpoints
├── admin-routes.js            # Admin management endpoints
├── payments-routes.js         # Stripe integration
├── auth-middleware.js         # JWT verification middleware
├── .env                       # Environment variables
└── package.json               # Dependencies
```

## Testing Workflow

### 1. Job Seeker Flow
1. Click "Sign Up"
2. Choose "Job Seeker" role
3. Enter email and password
4. Browse jobs
5. Save jobs
6. Click "View Details" to see full job info
7. Apply via email or website

### 2. Recruiter Flow
1. Click "Sign Up"
2. Choose "Recruiter" role
3. Enter company details
4. Job redirected to recruiter dashboard (after admin approval)
5. Post new jobs
6. View applicants and CV scores
7. Click "Feature Job" button (if premium) to pin to top
8. Go to "Billing" to upgrade to premium

### 3. Admin Flow
1. Login with admin credentials (manual database entry required)
2. Access `/admin-dashboard.html`
3. Approve pending recruiters
4. Review and approve job postings
5. View all recruiters and jobs

### Create an Admin User
Use the helper script when you want to add an admin account locally:

```bash
npm run create-admin -- --email admin@example.com --password YourPassword
```

Or set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in a `.env` file and run:

```bash
npm run create-admin
```

### Admin Login
After creating the admin account, open the browser page:

`http://localhost:3000/admin-login.html`

Enter your admin email and password, then click **Sign in**.

Once logged in, you will be redirected to the admin dashboard at:

`http://localhost:3000/admin-dashboard.html`

## Premium Features

- **Feature Job Listings**: Pin jobs to top of feed
- **Limited Featured Slots**: 5 featured jobs per month
- **Subscription Plans**:
  - Monthly: KES 10,000 (mock)
  - Yearly: KES 100,000 (mock)

## Mock Mode

If `PALPLUS_MOCK=true`, the system records a mock STK Push request for local testing.

## Notes

- Jobs are sorted by featured status first, then by creation date (latest first)
- Recruiter jobs are kept separate from sample job listings until approved
- Admin must approve both recruiter accounts and job postings
- JWT tokens are stored in localStorage (not production-safe)
- Use proper authentication and validation in production

## Future Enhancements

- Email notifications for recruiters and job seekers
- Advanced analytics and reporting
- Job recommendations based on CV
- Video interviews integration
- Team management for recruiters
- Role-based permissions and scopes
- Rate limiting and security improvements
- Mobile app version
