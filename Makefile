.PHONY: make
make:
	$(shell yarn bin)/tsc

.PHONY: watch
watch:
	$(shell yarn bin)/tsc -w

.PHONY: test
test:
	$(shell yarn bin)/tslint -p .

.PHONY: format
format:
	$(shell yarn bin)/tslint -p . --fix
