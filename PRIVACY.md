# Privacy Policy

JobRadar AI is designed to run inside your own GitHub repository. This project does not require a hosted backend by default, and your configuration, job data, workflow runs, and secrets stay within the repository and GitHub account where you install it.

## What JobRadar AI Processes

Depending on your configuration, JobRadar AI may process:

- Company career page URLs and ATS job board URLs
- Public job postings and job descriptions
- Parsed job signals such as role category, location, season, sponsorship, citizenship requirements, and qualifications
- Your `config.json` settings, such as target countries, role categories, keywords, AI provider, and email notification settings
- Email notification metadata needed to send alerts through your configured SMTP provider
- Job submissions from the **Add Job** issue form: company, role, posting link, and location

## Email Addresses in `config.json`

The sender address, SMTP username, and receiver addresses are stored in plain text in `config.json`. They also appear in the setup issue that generated the config.

If your repository is public, anyone can read these addresses. Use a dedicated sender account, and consider keeping the repository private if you do not want your receiver addresses exposed.

## GitHub Secrets

Sensitive values such as API keys, SMTP passwords, and personal access tokens should be stored in GitHub Actions Secrets.

Examples may include:

- `AI_API_KEY`
- `SMTP_PASS`
- `PAT`
- Other provider-specific credentials

Do not commit secrets directly into the repository.

## AI Provider Usage

If AI parsing is enabled, JobRadar AI may send public job description text and related job metadata to the AI provider you configure. This includes postings submitted through the **Add Job** issue form.

Supported providers are OpenAI, Google Gemini, and Anthropic. Some jobs are sent through the provider's Batch API instead of real-time requests; the same job data is sent either way.

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

- `config.json`, especially sender and receiver email addresses
- The setup issue and any **Add Job** issues
- Generated job data files
- GitHub Actions logs
- README output
- Any committed configuration or examples

## Third-Party Services

JobRadar AI may interact with third-party services depending on your setup, including:

- GitHub Actions
- Community-maintained job lists on GitHub, such as SimplifyJobs and vanshb03, fetched from `raw.githubusercontent.com`
- Company ATS APIs and career pages
- AI model providers
- SMTP or email providers

These requests fetch public job data. They do not include your configuration, email addresses, or secrets.

Each third-party service has its own privacy practices and terms.

## Security Recommendations

- Store credentials only in GitHub Secrets.
- Do not paste API keys or passwords into issues, pull requests, discussions, or logs.
- Review workflow logs before making a repository public.
- Use the minimum permissions required for personal access tokens.
- Rotate credentials if they are accidentally exposed.

## Contact

If you find a privacy or security issue, please do not open a public issue containing sensitive information. Report it privately through [GitHub private vulnerability reporting](https://github.com/Donkey0322/JobRadar-AI/security/advisories/new). See `SECURITY.md` for what to include.
