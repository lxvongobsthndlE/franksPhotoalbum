import axios from 'axios';

const CATEGORY_LABELS = {
  bug: ['feedback', 'feedback:bug', 'bug'],
  feature: ['feedback', 'feedback:feature', 'enhancement'],
  help: ['feedback', 'feedback:help'],
  report_user: ['feedback', 'feedback:report-user'],
  other: ['feedback', 'feedback:other'],
};

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildIssueTitle(category, subject) {
  const prefix = category === 'bug' ? '[Bug]' : category === 'feature' ? '[Feature]' : '[Feedback]';
  return `${prefix} ${subject}`;
}

function buildIssueBody(input) {
  return [
    `Aus Feedback-Ticket: ${input.feedbackId}`,
    `Kategorie: ${input.category}`,
    '',
    '## Nutzerbeschreibung',
    input.body,
    '',
    '## Admin-Notiz',
    input.decisionNote,
  ].join('\n');
}

function getGithubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const commonLabels = parseCsvList(process.env.GITHUB_FEEDBACK_COMMON_LABELS);

  if (!token || !owner || !repo) {
    throw new Error('GitHub-Integration ist nicht vollständig konfiguriert.');
  }

  return { token, owner, repo, commonLabels };
}

function buildLabels(category, commonLabels) {
  return dedupe([...(CATEGORY_LABELS[category] || ['feedback']), ...commonLabels]);
}

function toGithubError(error) {
  const apiMessage = error?.response?.data?.message;
  if (apiMessage) {
    return new Error(`GitHub-Issue konnte nicht erstellt werden: ${apiMessage}`);
  }
  if (error instanceof Error) {
    return new Error(`GitHub-Issue konnte nicht erstellt werden: ${error.message}`);
  }
  return new Error('GitHub-Issue konnte nicht erstellt werden.');
}

/**
 * Erstellt ein GitHub-Issue für ein Feedback-Ticket.
 * @param {{category: string, subject: string, body: string, feedbackId: string, decisionNote: string}} input
 * @returns {Promise<{number: number, url: string}>}
 */
export async function createFeedbackGithubIssue(input) {
  const { token, owner, repo, commonLabels } = getGithubConfig();

  try {
    const response = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        title: buildIssueTitle(input.category, input.subject),
        body: buildIssueBody(input),
        labels: buildLabels(input.category, commonLabels),
      },
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    return {
      number: response.data.number,
      url: response.data.html_url,
    };
  } catch (error) {
    throw toGithubError(error);
  }
}
