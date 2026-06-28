# Security Policy

JobRadar AI is an open-source template that runs inside your own GitHub repository using GitHub Actions. Because it may use API keys, SMTP credentials, personal access tokens, and AI provider credentials, please handle configuration and issue reports carefully.

## Supported Versions

This project is currently maintained from the `main` branch.

| Version                           | Supported   |
| --------------------------------- | ----------- |
| `main`                            | Yes         |
| Older forks or modified templates | Best effort |

If you created your own repository from this template, you are responsible for keeping your copy updated with security-related changes from the upstream repository.

## Reporting a Vulnerability

Please do not open a public issue containing sensitive information.

Sensitive information includes:

- API keys
- SMTP passwords
- GitHub personal access tokens
- GitHub Actions secrets
- Private repository names
- Private email addresses
- Private job preferences
- Workflow logs that expose credentials or internal configuration

If you find a vulnerability, please contact the maintainer privately.

Recommended report contents:

- A clear description of the issue
- Steps to reproduce, if applicable
- Affected files, workflows, or commands
- Whether any secret or token may have been exposed
- Suggested fix, if you have one

Please avoid including real credentials in your report. Use redacted examples instead.

## Secrets and Credentials

JobRadar AI expects sensitive values to be stored in GitHub Actions Secrets, not committed to the repository.

Common secrets may include:

- `AI_API_KEY`
- `SMTP_PASS`
- `PAT`
- Provider-specific API keys or tokens

Never commit secrets into:

- `config.json`
- `.env`
- README files
- Issue descriptions
- Pull requests
- GitHub Actions logs
- Generated data files

If a secret is accidentally exposed, rotate it immediately.

## GitHub Token Permissions

Use the minimum permissions required for your workflow.

Avoid using broad personal access tokens unless necessary. When possible, prefer the built-in `GITHUB_TOKEN` with limited workflow permissions.

If a personal access token is required, use a fine-grained token and only grant the permissions needed by your setup.

## Workflow Security

Before enabling workflows in a public repository, review:

- `.github/workflows/*`
- Issue-triggered workflows
- Pull request-triggered workflows
- Scripts that commit generated files
- Scripts that read issue form contents
- Scripts that call external APIs

Be careful with workflows triggered by issues, pull requests, or external contributors. Treat issue and pull request content as untrusted input.

## AI Provider Security

If AI parsing is enabled, public job descriptions and job metadata may be sent to the configured AI provider.

Do not send private notes, secrets, internal documents, or confidential job preferences to AI providers unless you understand and accept the provider’s data policy.

Review the privacy and data usage terms of your selected AI provider before enabling AI parsing.

## Email Security

If email notifications are enabled, JobRadar AI sends alerts through your configured SMTP provider.

Protect your SMTP credentials carefully. If your email provider supports app passwords, use an app password instead of your main account password.

## Public Repository Warning

If your JobRadar AI repository is public, the following may be visible to others:

- Generated job data
- README job board output
- Workflow run history
- Workflow logs
- Non-secret configuration values
- Open issues and issue form submissions

Do not put private information in public configuration files or issue forms.

## Dependency Security

This project uses Node.js and pnpm. To reduce dependency risk:

- Keep dependencies updated
- Review lockfile changes
- Run dependency audits when appropriate
- Avoid installing untrusted packages
- Review third-party GitHub Actions before using them

## Maintainer Notes

Security fixes may be released through commits, pull requests, or GitHub Releases.

Users who created repositories from this template should periodically compare their copy with the upstream repository and apply important workflow, dependency, and security updates.
