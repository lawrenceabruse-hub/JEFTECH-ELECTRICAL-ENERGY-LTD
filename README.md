# JEFTECH ELECTRICAL ENERGY LTD website

A responsive company website with customer enquiry storage, a password-protected content dashboard, and an automatically sliding work gallery. The photos are illustrative examples, not claims of completed JEFTECH projects. Customer enquiries and content are stored in PostgreSQL. The site does not use AI, an API key, or a visitor chat service.

## Backend features

- Website enquiries are saved for the admin to review and mark new, contacted, or closed.
- The dashboard at `/admin` can add, edit, and remove services and work-gallery items.
- Admin sign-in uses an HTTP-only, same-site session cookie and passwords hashed with Node.js scrypt.
- PostgreSQL stores administrator sessions, enquiries, services, and work-gallery content.

Enquiries are stored in the dashboard; this backend does not email notifications. A configured email provider can be added separately if email alerts are required.

## Run locally

Use Node.js 18 or later and a PostgreSQL database. Copy `.env.example` to `.env`, replace all example values, then run:

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The admin dashboard is at [http://localhost:3000/admin](http://localhost:3000/admin). On first startup, the backend creates the database tables and seeds the initial services and gallery entries. Keep `.env` private; never upload it to GitHub.

## Deploy with Render and a hosted PostgreSQL database

The Render web service can stay on the free plan. The database provider has its own plan limits and terms; verify its current free tier, backups, and retention before relying on it for business records.

1. Create a PostgreSQL database with a provider that supports external TLS connections. Copy its private connection URL (do not post it publicly).
2. In the Render dashboard, open the website service’s **Environment** settings. Add `DATABASE_URL` with that connection URL, `ADMIN_EMAIL` with the administrator email, and `ADMIN_PASSWORD` with a unique password of at least 14 characters. Do not use the example password.
3. Upload/push the project files to the connected GitHub repository, preserving the root `server.js`, `package.json`, `render.yaml`, and entire `index.html/` directory (including `images/`).
4. Deploy the latest commit in Render. Check `/healthz` for `"status":"ok"`, `"databaseConnected":true`, and `"websiteAssetsAvailable":true`.
5. Open `/admin`, sign in with `ADMIN_EMAIL` and the initial `ADMIN_PASSWORD`, then change the password in the dashboard. On first boot the configured credentials are hashed into the database; later changing the environment variable alone does not reset the stored password.
6. Submit a test enquiry from the public contact form and verify it appears under **Enquiries**. Add or edit a service/gallery item and reload the public page to verify it.

Do not place database URLs, admin passwords, or other credentials in client-side files, commit history, screenshots, or public messages. Render's free web service may spin down while idle, causing a delay on the first request.

## Public contact details

- Phone: `+234 706 758 7195`
- Email: `jeftech12345@hotmail.com`
- WhatsApp: `https://wa.me/2347067587195`
