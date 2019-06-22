import {generateState} from "../../../../utils/state";
import processAttestation from "../../../../../src/chain/stateTransition/block/attestations";
import {generateEmptyBlock} from "../../../../utils/block";
import {MAX_ATTESTATIONS, MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "../../../../../src/constants";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {
  convertToIndexed,
  getBeaconProposerIndex,
  validateIndexedAttestation
} from "../../../../../src/chain/stateTransition/util";
import sinon from "sinon";
import {hashTreeRoot} from "@chainsafe/ssz";
import {Crosslink} from "../../../../../src/types";

describe('process block - attestation', function () {

  const sandbox = sinon.createSandbox();

  let attestationSlotStub, currentEpochStub, previousEpochStub, validateIndexedAttestationStub,
    getBeaconProposerIndexStub;

  beforeEach(() => {
    attestationSlotStub = sandbox.stub(utils, 'getAttestationDataSlot');
    currentEpochStub = sandbox.stub(utils, 'getCurrentEpoch');
    previousEpochStub = sandbox.stub(utils, 'getPreviousEpoch');
    validateIndexedAttestationStub = sandbox.stub(utils, 'validateIndexedAttestation');
    getBeaconProposerIndexStub = sandbox.stub(utils, 'getBeaconProposerIndex');
    sandbox.stub(utils, 'convertToIndexed');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('fail to process attestation - exceeds inclusion delay', function () {
    const state = generateState({slot: MIN_ATTESTATION_INCLUSION_DELAY + 1});
    const attestation = generateEmptyAttestation();
    attestationSlotStub.returns(0);
    expect(() => processAttestation(state, attestation)).to.throw;
  });

  it('fail to process attestation - future epoch', function () {
    const state = generateState({slot: 0});
    const attestation = generateEmptyAttestation();
    attestationSlotStub.returns(SLOTS_PER_EPOCH + 1);
    expect(() => processAttestation(state, attestation)).to.throw;
  });

  it('fail to process attestation - crosslink not zerohash', function () {
    const state = generateState({slot: 0});
    const attestation = generateEmptyAttestation();
    attestation.data.crosslink.dataRoot = Buffer.alloc(32, 1);
    attestationSlotStub.returns(SLOTS_PER_EPOCH + 1);
    expect(() => processAttestation(state, attestation)).to.throw;
  });

  it.skip('should process attestation - currentEpoch === data.targetEpoch', function () {
    const state = generateState({slot: MIN_ATTESTATION_INCLUSION_DELAY + 1, currentJustifiedEpoch: 1});
    currentEpochStub.returns(1);
    previousEpochStub.returns(0);
    validateIndexedAttestationStub.returns(true);
    getBeaconProposerIndexStub.returns(2);
    const attestation = generateEmptyAttestation();
    attestation.data.targetEpoch = 1;
    attestation.data.sourceEpoch = 1;
    attestation.data.sourceRoot = state.currentJustifiedRoot;
    attestation.data.crosslink.parentRoot = hashTreeRoot(state.currentCrosslinks[attestation.data.crosslink.shard], Crosslink);
    attestationSlotStub.returns(1);
    // force equal
    state.currentCrosslinks[attestation.data.crosslink.shard].endEpoch = attestation.data.crosslink.startEpoch;

    expect(processAttestation(state, attestation)).to.not.throw;
    expect(state.currentEpochAttestations.length).to.be.equal(1);
    expect(state.previousEpochAttestations.length).to.be.equal(0);
  });

  it.skip('should process attestation - previousEpoch === data.targetEpoch', function () {
    const state = generateState({slot: MIN_ATTESTATION_INCLUSION_DELAY + 1, currentJustifiedEpoch: 1});
    currentEpochStub.returns(1);
    previousEpochStub.returns(0);
    validateIndexedAttestationStub.returns(true);
    getBeaconProposerIndexStub.returns(2);
    const attestation = generateEmptyAttestation();
    attestation.data.targetEpoch = 0;
    attestation.data.sourceEpoch = 0;
    attestation.data.sourceRoot = state.previousJustifiedRoot;
    attestation.data.crosslink.parentRoot = hashTreeRoot(state.currentCrosslinks[attestation.data.crosslink.shard], Crosslink);
    attestationSlotStub.returns(1);
    expect(processAttestation(state, attestation)).to.not.throw;
    expect(state.currentEpochAttestations.length).to.be.equal(0);
    expect(state.previousEpochAttestations.length).to.be.equal(1);
  });

});
