const { writeFileSync } = require('fs');
const { pickBy } = require('lodash');
const mm = require('micromatch');
const c = require('chalk');

const pluginName = 'frontmatter-lint';
const dumpFile = './frontmatter-errors.json';

module.exports = (options, ctx) => {
  let errorsByPath = {};
  const { specs } = options;

  if (!specs) {
    console.log(
      c.cyan(`plugin-${pluginName}`) + ` No frontmatter specs found.`
    );
    return { name: pluginName };
  }

  if (typeof specs !== 'object') {
    console.log(
      c.cyan(`plugin-${pluginName}`) +
        ` Invalid frontmatter specs type: expected object, got ${typeof specs}`
    );
    return { name: pluginName };
  }

  const exclude = options.exclude || [];

  return {
    name: pluginName,
    extendPageData($page) {
      const {
        regularPath, // file's absolute path
        frontmatter // page's frontmatter object
      } = $page;

      const matchesExclude = mm([regularPath], exclude);

      if (matchesExclude.length) {
        return;
      }

      const requiredFields = pickBy(specs, s => s.required === true);
      Object.keys(requiredFields).forEach(fieldName => {
        if (Object.keys(frontmatter).indexOf(fieldName) === -1) {
          const error = {
            error: 'MISSING_KEY',
            key: fieldName
          };
          addError(errorsByPath, regularPath, error);
        }
      });

      Object.keys(frontmatter).forEach(key => {
        if (!key) {
          addError(errorsByPath, regularPath, {
            error: 'EMPTY_KEY'
          });
          return;
        }
        if (!hasOwn(specs, key)) {
          addError(errorsByPath, regularPath, {
            error: 'INVALID_KEY',
            key
          });
          return;
        }
        const value = frontmatter[key];
        if (value === null || typeof value === 'undefined') {
          addError(errorsByPath, regularPath, {
            error: 'EMPTY_VALUE',
            key
          });
          return;
        }
        const spec = specs[key];
        const assertResult = assertType(value, spec.type);
        if (!assertResult.valid) {
          addError(errorsByPath, regularPath, {
            error: 'INVALID_TYPE',
            key,
            expected: getType(spec.type),
            got: typeof value
          });
          return;
        }
        if (hasOwn(spec, 'allowedValues')) {
          if (!assertAllowedValue(value, spec.allowedValues)) {
            addError(errorsByPath, regularPath, {
              error: 'INVALID_VALUE',
              key,
              expected: JSON.stringify(spec.allowedValues),
              got: value
            });
          }
        }
      });
    },
    updated() {
      if (Object.keys(errorsByPath).length) {
        generateConsoleReport(errorsByPath);
      }
    },
    ready() {
      if (options.postProcessErrors) {
        errorsByPath = options.postProcessErrors(errorsByPath, ctx);
      }

      if (Object.keys(errorsByPath).length) {
        generateConsoleReport(errorsByPath);
        if (options.dumpToFile) {
          dumpErrorsToFile(
            errorsByPath,
            options.dumpFile || dumpFile,
            ctx.sourceDir
          );
        }
        errorsByPath = {};
        if (options.abortBuild) {
          console.error(c.red('\nAborting build.\n'));
          process.exit(1);
        }
      }
    }
    // extendCli(cli) {
    //   cli
    //     .command('toto [targetDir]', 'Applies the fixes from file to the repo')
    //     .option('-e --errors <file>', 'A file containing the dumped errors')
    //     .option('-y --yes', 'Answer yes to all prompts')
    //     .action((dir = '.', options) => {
    //       console.log(
    //         `executing on dir ${dir} with options ${JSON.stringify(
    //           options,
    //           null,
    //           2
    //         )}`
    //       );
    //       process.exit(0);
    //     });
    // }
  };
};

function dumpErrorsToFile(errors, fileName, sourceDir) {
  writeFileSync(fileName, JSON.stringify(errors, null, 4));
  console.log(`Frontmatter errors have been dumped to ${c.yellow(fileName)}\n`);
  console.log(
    c.cyan(
      `You might consider running the auto-fixer with the following command\n`
    )
  );
  console.log(
    c.bold.whiteBright(
      `  $(npm bin)/frontmatter-fix -e ${fileName} -d ${sourceDir}`
    )
  );
}

function generateConsoleReport(errors) {
  console.error(
    '\n' +
      c.cyan(`plugin-${pluginName}`) +
      c.redBright(` Some pages do not have a valid frontmatter.\n`)
  );
  Object.keys(errors).forEach(path => {
    const errorsOnFile = errors[path];
    console.log(c.whiteBright(`- ${path}`));

    errorsOnFile.forEach(e => {
      if (e.error === 'EMPTY_KEY') {
        console.log(c.yellow(`  ${e.error}`));
      } else {
        console.log(c.yellow(`  ${e.error}`) + ` on field ` + c.cyan(e.key));
        if (e.expected) {
          console.log(c.gray(`    Expected: `) + e.expected);
        }
        if (e.got) {
          console.log(c.gray(`    Got: `) + c.red(e.got));
        }
      }
    });
    console.log('');
  });
  console.log('');
}

function addError(errors, path, error) {
  if (!errors[path]) {
    errors[path] = [];
  }
  errors[path].push(error);
}

function assertAllowedValue(value, allowedValues) {
  return allowedValues.indexOf(value) > -1;
}

const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol)$/;

function assertType(value, type) {
  let valid;
  const expectedType = getType(type);
  if (simpleCheckRE.test(expectedType)) {
    const t = typeof value;
    valid = t === expectedType.toLowerCase();
    // for primitive wrapper objects
    if (!valid && t === 'object') {
      valid = value instanceof type;
    }
  } else {
    valid = value instanceof type;
  }
  return {
    valid,
    expectedType
  };
}

/**
 * Use function string name to check built-in types,
 * because a simple equality check will fail when running
 * across different vms / iframes.
 */
function getType(fn) {
  const match = fn && fn.toString().match(/^\s*function (\w+)/);
  return match ? match[1] : '';
}

/**
 * Check whether an object has the property.
 */
const hasOwnProperty = Object.prototype.hasOwnProperty;
function hasOwn(obj, key) {
  return hasOwnProperty.call(obj, key);
}
