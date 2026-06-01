# Domain Setup for t-hawthorne.com

Use these steps after the static portfolio site is ready to publish.

1. Buy the domain `t-hawthorne.com` from a domain registrar. This is already done.
2. Deploy the website to Cloudflare Pages.
3. Cloudflare Pages will provide a temporary URL for the deployed site.
4. In Cloudflare Pages, open the project and select **Custom Domain**.
5. Enter `t-hawthorne.com`.
6. Follow Cloudflare's DNS instructions.
7. Add the required DNS records in Cloudflare DNS or at the registrar, depending on where DNS is managed.
8. Wait for DNS propagation. This can take a few minutes, but some changes may take longer.
9. Confirm SSL is active in Cloudflare Pages.
10. Test both domain versions:
    - `https://t-hawthorne.com`
    - `https://www.t-hawthorne.com`

## Cloudflare Pages Settings

- Preferred host: Cloudflare Pages
- Build command: leave blank
- Output directory: `portfolio-site`
- Site type: static HTML, CSS, and JavaScript

## Notes

- If Cloudflare asks for a `CNAME` record for `www`, add it exactly as Cloudflare provides it.
- If Cloudflare asks for an apex/root domain record for `t-hawthorne.com`, add the record exactly as Cloudflare provides it.
- Keep DNS records consistent with Cloudflare's current instructions because the exact target values can vary by Pages project.
