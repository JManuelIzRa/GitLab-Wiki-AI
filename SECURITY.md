# Security policy

## Reporting a vulnerability

Please do not disclose security vulnerabilities in a public issue. Report them
privately through the repository owner's GitHub security contact or a private
communication channel listed on the owner's profile.

Include the affected version or commit, reproduction steps, impact, and any known
mitigation. Avoid including real GitLab tokens, API keys, repository content, or
other secrets in the report.

## Deployment notes

- Treat GitLab personal access tokens and LLM/embedding API keys as secrets.
- Set `GITLAB_WEBHOOK_SECRET` and `GITLAB_WEBHOOK_SECRET_REQUIRED=true` when the
  webhook endpoint is publicly reachable.
- Restrict `CORS_ORIGINS` in production instead of using the development default.
- Keep the Python, Node.js, container, Qdrant, and application dependencies patched.
