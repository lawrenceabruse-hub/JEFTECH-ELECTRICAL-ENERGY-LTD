# JEFTECH ELECTRICAL ENERGY LTD website

A responsive company website with direct email, phone, and WhatsApp contact links, plus an automatically sliding electrical work and panel photo gallery. The images are examples, not claims of completed JEFTECH projects. The site does not use AI, an API key, or a visitor chat service.

## Preview locally

Open `index.html/index.html` in a browser, or run the site through Node.js 18 or later:

```sh
npm start
```

Then open [http://localhost:3000](http://localhost:3000). Check that the site assets are available at `/healthz`.

## Publish with Render

The included `render.yaml` deploys the website as a small Node.js web service. No API key or other secret is required.

1. Upload the project files to a GitHub repository, keeping `server.js`, `package.json`, `render.yaml`, and the full `index.html/` folder (including its `images/` subfolder) together.
2. In Render, select **New > Blueprint**, connect the repository, and deploy using `render.yaml`. If updating the earlier AI deployment, push these changes and redeploy the existing service; remove the unused `OPENAI_API_KEY` from that service's Environment settings.
3. After deployment, open the Render URL. Check `/healthz` and confirm it returns `"status":"ok"` and `"websiteAssetsAvailable":true`.
4. Add a custom domain from the Render service settings if desired, and follow the DNS instructions shown by Render.
5. Submit `https://YOUR-DOMAIN/sitemap.xml` in Google Search Console to help Google discover the site. Indexing and search ranking are controlled by Google and are not guaranteed.

Render's free service may spin down while idle. An always-on hosting plan avoids that delay and may have a cost.

## Contact links

- Phone: `+234 706 758 7195`
- Email: `jeftech12345@hotmail.com`
- WhatsApp: `https://wa.me/2347067587195`
