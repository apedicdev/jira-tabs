// electron-builder settings for GitLab Tabs (npm run dist:gitlab): the same app as Jira Tabs,
// with the GitLab rules, its own name, link type, icon and output folder.
const base = require('../package.json').build;

module.exports = {
  ...base,
  appId: 'io.github.apedicdev.gitlab-tabs',
  productName: 'GitLab Tabs',
  extraMetadata: {
    appProfile: 'gitlab',
    productName: 'GitLab Tabs',
    description: 'GitLab in its own app, with one tab per issue and merge request.',
  },
  protocols: [{ name: 'GitLab Tabs link', schemes: ['gitlab-tabs'] }],
  mac: { ...base.mac, icon: 'build/gitlab/icon.icns' },
  win: { ...base.win, icon: 'build/gitlab/icon.png' },
  dmg: { title: 'GitLab Tabs' },
  directories: { ...base.directories, output: 'dist/gitlab' },
};
