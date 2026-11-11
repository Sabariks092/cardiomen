const { withProjectBuildGradle } = require('expo/config-plugins');

/**
 * On Windows, native libraries (react-native-screens, worklets...) build their C++ inside
 * node_modules, where CMake mirrors the full source path under each object folder. With a project
 * in a deep folder that passes 260 characters, and the Ninja bundled with the Android SDK's CMake
 * can't create it. This moves every module's C++ build folder to <drive>:\cx\<module>, which keeps
 * the paths short. Other platforms are unaffected.
 *
 * It must come before the root plugins are applied: they configure the app and its libraries
 * straight away, and the folder can't be changed after that.
 */
const MARK = '// cardigo: short native build path';
const ANCHOR = 'apply plugin: "expo-root-project"';

const SNIPPET = `${MARK}
if (System.getProperty('os.name').toLowerCase().contains('windows')) {
  def cxxRoot = new File(rootProject.projectDir.toPath().getRoot().toFile(), 'cx')
  subprojects { p ->
    ['com.android.library', 'com.android.application'].each { id ->
      p.plugins.withId(id) {
        p.android.externalNativeBuild.cmake.buildStagingDirectory = new File(cxxRoot, p.name)
      }
    }
  }
}

`;

function addSnippet(contents) {
  if (contents.includes(MARK)) return contents;
  const at = contents.indexOf(ANCHOR);
  return at < 0 ? SNIPPET + contents : contents.slice(0, at) + SNIPPET + contents.slice(at);
}

module.exports = function withShortNativeBuildPath(config) {
  return withProjectBuildGradle(config, (c) => {
    c.modResults.contents = addSnippet(c.modResults.contents);
    return c;
  });
};
module.exports.addSnippet = addSnippet;
