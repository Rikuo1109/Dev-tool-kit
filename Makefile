lint:
	npx tsc --noEmit
	npx eslint src --ext .ts,.tsx,.js,.jsx,.mjs,.cjs

public:
	yarn install:local
