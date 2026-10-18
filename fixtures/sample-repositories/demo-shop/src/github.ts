import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function listIssues(owner: string, repo: string) {
  // Uses the GitHub SDK, but not the endpoint affected by the seeded GitHub event.
  const viaMethod = await octokit.rest.issues.listForRepo({ owner, repo });
  const viaRequest = await octokit.request('GET /repos/{owner}/{repo}/issues', { owner, repo });
  return { viaMethod, viaRequest };
}
