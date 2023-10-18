// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const { parseEther } = require("ethers/lib/utils");
const {
  run,
  ethers: {
    getContract,
    getContractAt,
    getSigners,
    constants: { AddressZero },
  },
  deployments: { fixture, deploy },
} = require("hardhat");

process.env.TEST = true;
describe("PMXToken", function () {
  let recipient, registry, user2;

  before(async function () {
    await fixture(["Test"]);
    registry = await getContract("Registry");

    [recipient, user2] = await getSigners();
  });

  describe("deploy with zero recipient address", function () {
    let PMXToken, initialSupply;

    before(async function () {
      await fixture(["Test"]);

      PMXToken = await getContract("PMXToken");

      initialSupply = parseEther("1000000000");
    });

    it("Should contain tokens total supply equal to initialSupply after the contract deploy", async function () {
      expect(await PMXToken.totalSupply()).to.equal(initialSupply);
    });

    it("Should mint total supply to deployer", async function () {
      const x = await deploy("PMXToken1", {
        from: user2.address,
        contract: "PMXToken",
        args: [AddressZero],
        log: true,
      });
      const PMXToken = await getContractAt("PMXToken", x.address);
      expect(await PMXToken.totalSupply()).to.equal(await PMXToken.balanceOf(user2.address));
    });
  });
  describe("deploy with non-zero recipient address", function () {
    let PMXToken;

    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      await fixture(["Test"]);

      await run("deploy:PMXToken", {
        recipient: recipient.address,
        registry: registry.address,
      });
      PMXToken = await getContract("PMXToken");
    });

    it("Should mint total supply to recipient", async function () {
      expect(await PMXToken.totalSupply()).to.equal(await PMXToken.balanceOf(recipient.address));
    });
  });
});
