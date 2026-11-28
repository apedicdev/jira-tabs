// electron-builder settings for GitLab Tabs 2 (npm run dist:gitlab): the same app as Jira Tabs 2,
// with the GitLab rules, its own name, link type, icon and output folder. Version 2 is a separate
// app from GitLab Tabs, so both can be installed.
const base = require('../package.json').build;

module.exports = {
  ...base,
  appId: 'io.github.apedicdev.gitlab-tabs-2',
  productName: 'GitLab Tabs 2',
  extraMetadata: {
    appProfile: 'gitlab',
    productName: 'GitLab Tabs 2',
    description: 'GitLab in its own app, with one tab per issue and merge request.',
  },
  protocols: [{ name: 'GitLab Tabs 2 link', schemes: ['gitlab-tabs-2'] }],
  mac: { ...base.mac, icon: 'build/gitlab-2/icon.icns' },
  win: { ...base.win, icon: 'build/gitlab-2/icon.png' },
  dmg: { title: 'GitLab Tabs 2' },
  directories: { ...base.directories, output: 'dist/gitlab' },
};
