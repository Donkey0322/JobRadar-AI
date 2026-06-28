# Privacy Policy

JobRadar AI is designed to run inside your own GitHub repository. This project does not require a hosted backend by default, and your configuration, job data, workflow runs, and secrets stay within the repository and GitHub account where you install it.

## What JobRadar AI Processes

Depending on your configuration, JobRadar AI may process:

- Company career page URLs and ATS job board URLs
- Public job postings and job descriptions
- Parsed job signals such as role category, location, season, sponsorship, citizenship requirements, and qualifications
- Your `config.json` settings, such as target countries, role categories, schedule preferences, and email notification settings
- Email notification metadata needed to send alerts through your configured SMTP provider

## GitHub Secrets

Sensitive values such as API keys, SMTP passwords, and personal access tokens should be stored in GitHub Actions Secrets.

Examples may include:

- `AI_API_KEY`
- `SMTP_PASS`
- `PAT`
- Other provider-specific credentials

Do not commit secrets directly into the repository.

## AI Provider Usage

If AI parsing is enabled, JobRadar AI may send public job description text and related job metadata to the AI provider you configure.

The project may support providers such as OpenAI, Google Gemini, Anthropic, or other compatible APIs depending on your configuration.

You are responsible for reviewing the privacy policy and data usage terms of the AI provider you choose.

## Email Notifications

If email notifications are enabled, JobRadar AI uses your configured SMTP settings to send matched job alerts.

The project does not provide its own email delivery service by default. Emails are sent through the account or provider you configure.

## Analytics

By default, JobRadar AI does not send install analytics, usage events, repository names, email addresses, or private configuration data to the original template repository owner.

If future versions add optional analytics or install tracking, it should be clearly documented and disabled unless explicitly enabled by the user.

## Public Repository Notice

If you use JobRadar AI in a public repository, generated job data, configuration files, workflow logs, and README output may be publicly visible.

Before making your repository public, review:

- `config.json`
- Generated job data files
- GitHub Actions logs
- README output
- Any committed configuration or examples

## Third-Party Services

JobRadar AI may interact with third-party services depending on your setup, including:

- GitHub Actions
- Company ATS APIs and career pages
- AI model providers
- SMTP or email providers

Each third-party service has its own privacy practices and terms.

## Security Recommendations

- Store credentials only in GitHub Secrets.
- Do not paste API keys or passwords into issues, pull requests, discussions, or logs.
- Review workflow logs before making a repository public.
- Use the minimum permissions required for personal access tokens.
- Rotate credentials if they are accidentally exposed.

## Contact

If you find a privacy or security issue, please do not open a public issue containing sensitive information. Instead, contact the repository maintainer privately or follow the instructions in `SECURITY.md` if available.
