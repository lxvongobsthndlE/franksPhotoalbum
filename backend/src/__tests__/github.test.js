import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: axiosPost,
  },
}));

describe('github.js', () => {
  const originalEnv = { ...process.env };
  let github;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITHUB_TOKEN: 'ghs_test',
      GITHUB_OWNER: 'frankzudemo17',
      GITHUB_REPO: 'Fotoalbum',
      GITHUB_FEEDBACK_COMMON_LABELS: 'triage,from-feedback',
    };
    github = await import('../utils/github.js');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates a GitHub issue with feedback metadata and category labels', async () => {
    axiosPost.mockResolvedValue({
      data: {
        number: 17,
        html_url: 'https://github.com/frankzudemo17/Fotoalbum/issues/17',
      },
    });

    const issue = await github.createFeedbackGithubIssue({
      category: 'bug',
      subject: 'Export defekt',
      body: 'Beim Export fehlt Inhalt.',
      feedbackId: 'rep-17',
      decisionNote: 'Wird umgesetzt',
    });

    expect(axiosPost).toHaveBeenCalledWith(
      'https://api.github.com/repos/frankzudemo17/Fotoalbum/issues',
      expect.objectContaining({
        title: '[Bug] Export defekt',
        labels: ['feedback', 'feedback:bug', 'bug', 'triage', 'from-feedback'],
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghs_test',
        }),
      })
    );
    expect(issue).toEqual({
      number: 17,
      url: 'https://github.com/frankzudemo17/Fotoalbum/issues/17',
    });
  });

  it('maps GitHub API errors to a readable issue creation error', async () => {
    axiosPost.mockRejectedValue({
      response: {
        data: { message: 'Validation Failed' },
      },
    });

    await expect(
      github.createFeedbackGithubIssue({
        category: 'feature',
        subject: 'Idee',
        body: 'Bitte ergänzen.',
        feedbackId: 'rep-18',
        decisionNote: 'Sinnvoll',
      })
    ).rejects.toThrow('GitHub-Issue konnte nicht erstellt werden: Validation Failed');
  });

  it('fails fast when GitHub env vars are missing', async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(
      github.createFeedbackGithubIssue({
        category: 'feature',
        subject: 'Idee',
        body: 'Bitte ergänzen.',
        feedbackId: 'rep-18',
        decisionNote: 'Noch offen',
      })
    ).rejects.toThrow('GitHub-Integration ist nicht vollständig konfiguriert.');
  });
});
