module.exports = {
  '*.md': ['prettier --write'],
  '*.{ts,tsx,json}': ['prettier --write', 'eslint --fix'],
  '*.{ts,tsx}': [() => 'npm run lint:ts'],
};
