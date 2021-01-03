import {expect} from "chai";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {collectResponses} from "../../../../../src/network/reqresp/request/collectResponses";
import {Method} from "../../../../../src/constants";
import {arrToSource} from "../utils";

describe("network / reqresp / request / collectResponses", () => {
  const chunk: ResponseBody = BigInt(1);

  const testCases: {
    id: string;
    method: Method;
    maxResponses?: number;
    sourceChunks: ResponseBody[];
    expectedReturn: ResponseBody | ResponseBody[];
  }[] = [
    {
      id: "Single chunk",
      method: Method.Ping,
      sourceChunks: [chunk, chunk],
      expectedReturn: chunk,
    },
    {
      id: "Limit to maxResponses",
      method: Method.BeaconBlocksByRange,
      sourceChunks: [chunk, chunk, chunk],
      maxResponses: 2,
      expectedReturn: [chunk, chunk],
    },
  ];

  for (const {id, method, maxResponses, sourceChunks, expectedReturn} of testCases) {
    it(id, async () => {
      const responses = await collectResponses(method, maxResponses)(arrToSource(sourceChunks));
      expect(responses).to.deep.equal(expectedReturn);
    });
  }
});
