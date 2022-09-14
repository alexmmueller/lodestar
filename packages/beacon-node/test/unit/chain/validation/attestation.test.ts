import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {BitArray, fromHexString, toHexString} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {AttestationErrorCode} from "../../../../src/chain/errors/index.js";
import {validateGossipAttestation} from "../../../../src/chain/validation/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
// eslint-disable-next-line import/no-relative-packages
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../state-transition/test/perf/util.js";
import {memoOnce} from "../../../utils/cache.js";
import {getAttestationValidData, AttestationValidDataOpts} from "../../../utils/validationData/attestation.js";

describe("chain / validation / attestation", () => {
  const vc = 64;
  const stateSlot = 100;

  const UNKNOWN_ROOT = Buffer.alloc(32, 1);
  const KNOWN_TARGET_ROOT = Buffer.alloc(32, 0xd0);
  const KNOWN_BEACON_BLOCK_ROOT = Buffer.alloc(32, 0xd1);

  const getState = memoOnce(() => generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}));

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function getValidData(opts?: Partial<AttestationValidDataOpts>) {
    return getAttestationValidData({
      currentSlot: stateSlot,
      attSlot: opts?.currentSlot ?? stateSlot,
      attIndex: 1,
      bitIndex: 1,
      targetRoot: KNOWN_TARGET_ROOT,
      beaconBlockRoot: KNOWN_BEACON_BLOCK_ROOT,
      state: getState(),
      ...opts,
    });
  }

  it.only("serialize unaggregated attestations", () => {
    const attestation: phase0.Attestation = {
      aggregationBits: BitArray.fromBoolArray(Array.from({length: 180}, () => false)),
      data: {
        slot: 3849723,
        index: 51,
        beaconBlockRoot: fromHexString("0x336304cc19cc0cfacb234c52ba4c12d73be9e581fba26d6da401f16dc685dc23"),
        source: {
          epoch: 120302,
          root: fromHexString("0xe312659945be76a65a8bc9288246eb555073056664733a9313b4615e08a0d18b"),
        },
        target: {
          epoch: 120303,
          root: fromHexString("0x467997e91dec5b8f4b2cc4e67d82a761cfddecbcb6a3b1abc5d46646203b2512"),
        },
      },
      signature: fromHexString("0xa0a09d4d138a959fc3513289feefb2e65c4339fe7a505d8ba794b48eb1bc6f359e6a3e7643a4a5717ec5c64e32b6666d02d69b5cff4487d2fc76e67dedb79ebf0500e2c844d8ceff5c29d2d1c73c7e61fb369075a09abdaece4a2657846a500a"),
    };

    const bytes = ssz.phase0.Attestation.serialize(attestation);
    console.log(toHexString(bytes));
    console.log(bytes);
  });

  it("Valid", async () => {
    const {chain, attestation, subnet} = getValidData();

    await validateGossipAttestation(chain, attestation, subnet);
  });

  it("BAD_TARGET_EPOCH", async () => {
    const {chain, attestation, subnet} = getValidData();

    // Change target epoch to it doesn't match data.slot
    attestation.data.target.epoch += 1;

    await expectError(chain, attestation, subnet, AttestationErrorCode.BAD_TARGET_EPOCH);
  });

  it("PAST_SLOT", async () => {
    // Set attestation at a very old slot
    const {chain, attestation, subnet} = getValidData({attSlot: stateSlot - SLOTS_PER_EPOCH - 3});

    await expectError(chain, attestation, subnet, AttestationErrorCode.PAST_SLOT);
  });

  it("FUTURE_SLOT", async () => {
    // Set attestation to a future slot
    const {chain, attestation, subnet} = getValidData({attSlot: stateSlot + 2});

    await expectError(chain, attestation, subnet, AttestationErrorCode.FUTURE_SLOT);
  });

  it("NOT_EXACTLY_ONE_AGGREGATION_BIT_SET - 0 bits", async () => {
    // Unset the single aggregationBits
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    attestation.aggregationBits.set(bitIndex, false);

    await expectError(chain, attestation, subnet, AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET);
  });

  it("NOT_EXACTLY_ONE_AGGREGATION_BIT_SET - 2 bits", async () => {
    // Set an extra bit in the attestation
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    attestation.aggregationBits.set(bitIndex + 1, true);

    await expectError(chain, attestation, subnet, AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET);
  });

  it("UNKNOWN_BEACON_BLOCK_ROOT", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Set beaconBlockRoot to a root not known by the fork choice
    attestation.data.beaconBlockRoot = UNKNOWN_ROOT;

    await expectError(chain, attestation, subnet, AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT);
  });

  it("INVALID_TARGET_ROOT", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Set target.root to an unknown root
    attestation.data.target.root = UNKNOWN_ROOT;

    await expectError(chain, attestation, subnet, AttestationErrorCode.INVALID_TARGET_ROOT);
  });

  it("WRONG_NUMBER_OF_AGGREGATION_BITS", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Increase the length of aggregationBits beyond the committee size
    attestation.aggregationBits = new BitArray(
      attestation.aggregationBits.uint8Array,
      attestation.aggregationBits.bitLen + 1
    );

    await expectError(chain, attestation, subnet, AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS);
  });

  it("INVALID_SUBNET_ID", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Pass a different subnet value than the correct one
    const invalidSubnet = subnet === 0 ? 1 : 0;

    await expectError(chain, attestation, invalidSubnet, AttestationErrorCode.INVALID_SUBNET_ID);
  });

  it("ATTESTATION_ALREADY_KNOWN", async () => {
    const {chain, attestation, subnet, validatorIndex} = getValidData();
    // Register attester as already seen
    chain.seenAttesters.add(attestation.data.target.epoch, validatorIndex);

    await expectError(chain, attestation, subnet, AttestationErrorCode.ATTESTATION_ALREADY_KNOWN);
  });

  it("INVALID_SIGNATURE", async () => {
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    // Change the bit index so the signature is validated against a different pubkey
    attestation.aggregationBits.set(bitIndex, false);
    attestation.aggregationBits.set(bitIndex + 1, true);

    await expectError(chain, attestation, subnet, AttestationErrorCode.INVALID_SIGNATURE);
  });

  /** Alias to reduce code duplication */
  async function expectError(
    chain: IBeaconChain,
    attestation: phase0.Attestation,
    subnet: number,
    errorCode: AttestationErrorCode
  ): Promise<void> {
    await expectRejectedWithLodestarError(validateGossipAttestation(chain, attestation, subnet), errorCode);
  }
});
