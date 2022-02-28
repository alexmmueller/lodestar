# Geth Docker setup for running the sim merge tests on local machine

###### Build geth docker image

```bash
cd kiln/gethdocker
docker build  . --tag geth:kiln
```

###### Run test scripts

```bash
cd packages/lodestar
EL_BINARY_DIR=geth:kiln EL_SCRIPT_DIR=kiln/gethdocker EL_PORT=8545 ENGINE_PORT=8551 TX_SCENARIOS=simple yarn mocha test/sim/merge-interop.test.ts
```