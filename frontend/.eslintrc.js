const overrides = {
  eqeqeq: ['error', 'always', { null: 'ignore' }], // noisy
  'id-length': 'off', // noisy
  'no-console': 'off', // noisy
  'no-eq-null': 'off', // noisy
  'react/forbid-component-props': 'off', // noisy
  'react/prop-types': 'off', // noisy
  'canonical/sort-keys': 'off', // noisy
  'unicorn/no-array-reduce': 'off', // noisy
  'canonical/id-match': 'off', // noisy — API fields use snake_case
  complexity: 'off', // noisy
  'no-alert': 'off', // confirm() dialogs are intentional UX
  'no-negated-condition': 'off', // noisy
  'promise/prefer-await-to-then': 'off', // noisy
  'require-unicode-regexp': 'off', // noisy
  'unicorn/prevent-abbreviations': 'off', // noisy
  'jsx-a11y/click-events-have-key-events': 'off', // clickable rows/cards everywhere
  'jsx-a11y/label-has-associated-control': 'off', // noisy
  'jsx-a11y/no-noninteractive-element-interactions': 'off', // noisy
  'jsx-a11y/no-static-element-interactions': 'off', // noisy
  'react/no-unstable-nested-components': ['error', { allowAsProps: true }], // recharts tooltips
};

/** @type {import('eslint').Linter.Config} */
module.exports = {
  env: { es2021: true },
  extends: ['canonical/auto', 'canonical/browser', 'canonical/node'],
  // The upstream distribution is kept intact apart from its documented backport;
  // its security and compatibility are checked by test:dependency-security.
  ignorePatterns: ['build', 'node_modules', 'package-lock.json', 'vendor'],
  overrides: [
    {
      extends: [
        'canonical',
        'canonical/regexp',
        'canonical/jsdoc',
        'canonical/jsx-a11y',
        'canonical/react',
        'canonical/prettier',
      ],
      files: ['*.jsx'],
      parserOptions: {
        babelOptions: {
          parserOpts: {
            plugins: ['jsx'],
          },
        },
      },
      rules: {
        ...overrides,
        'react/no-set-state': 'off', // only useful when using state libs
      },
    },
    {
      extends: ['canonical/jest'],
      files: '*.test.{js,jsx}',
    },
  ],
  root: true,
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    ...overrides,

    'import/no-unassigned-import': [
      'error',
      {
        allow: ['semantic-ui-less/semantic.less', '**/*.css'],
      },
    ],
  },
};
