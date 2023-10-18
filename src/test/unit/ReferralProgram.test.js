// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  getNamedAccounts,
  ethers: { getNamedSigners, getContract },
  deployments: { fixture },
  getUnnamedAccounts,
} = require("hardhat");
const { deployMockAccessControlUpgradeable } = require("../utils/waffleMocks");
const { MEDIUM_TIMELOCK_ADMIN } = require("../../Constants");

process.env.TEST = true;

describe("ReferralProgram_unit", function () {
  let referralProgram, errorsLibrary;
  let deployer, user2;
  let referrers, referralProgramUnits;
  let snapshotId;
  let mockRegistry;

  before(async function () {
    await fixture(["ReferralProgram", "Errors"]);
    referralProgram = await getContract("ReferralProgram");
    errorsLibrary = await getContract("Errors");
    ({ deployer, user2 } = await getNamedSigners());
    mockRegistry = await deployMockAccessControlUpgradeable(deployer);
    await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, user2.address).returns(false);

    const { trader, trader2, user, user3 } = await getNamedAccounts();
    referrers = [trader, trader2, user, user3];
  });

  beforeEach(async function () {
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });
  });

  describe("setReferrals", function () {
    let referrals;
    before(async function () {
      referrals = await getUnnamedAccounts();
    });
    beforeEach(async function () {
      referralProgramUnits = [
        { referrer: referrers[0], referrals: [referrals[0], referrals[1]] },
        { referrer: referrers[1], referrals: [referrals[2]] },
        { referrer: referrers[2], referrals: [referrals[3], referrals[4], referrals[5]] },
      ];
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should revert if caller is not granted with MEDIUM_TIMELOCK_ADMIN", async function () {
      await expect(referralProgram.connect(user2).setReferrals(referralProgramUnits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should set referrals of particular referrer", async function () {
      await referralProgram.setReferrals(referralProgramUnits);
      for (let i; i < referralProgramUnits.length; i++) {
        const realReferrals = await referralProgram.getReferralsOf(referralProgramUnits[i].referrer);
        expect(realReferrals).to.deep.equal(referralProgramUnits[i].referrals);
      }
    });

    it("Should emit SetReferralByAdmin and SetReferrerByAdmin", async function () {
      await expect(referralProgram.setReferrals(referralProgramUnits))
        .to.emit(referralProgram, "SetReferralByAdmin")
        .withArgs(referralProgramUnits[0].referrer, referralProgramUnits[0].referrals[0])
        .to.emit(referralProgram, "SetReferralByAdmin")
        .withArgs(referralProgramUnits[0].referrer, referralProgramUnits[0].referrals[1])
        .to.emit(referralProgram, "SetReferrerByAdmin")
        .withArgs(referralProgramUnits[0].referrer)
        .to.emit(referralProgram, "SetReferralByAdmin")
        .withArgs(referralProgramUnits[1].referrer, referralProgramUnits[1].referrals[0])
        .to.emit(referralProgram, "SetReferrerByAdmin")
        .withArgs(referralProgramUnits[1].referrer)
        .to.emit(referralProgram, "SetReferralByAdmin")
        .withArgs(referralProgramUnits[2].referrer, referralProgramUnits[2].referrals[0])
        .to.emit(referralProgram, "SetReferralByAdmin")
        .withArgs(referralProgramUnits[2].referrer, referralProgramUnits[2].referrals[1])
        .to.emit(referralProgram, "SetReferralByAdmin")
        .withArgs(referralProgramUnits[2].referrer, referralProgramUnits[2].referrals[2])
        .to.emit(referralProgram, "SetReferrerByAdmin")
        .withArgs(referralProgramUnits[2].referrer);
    });

    it("Should set referrer for a particular referral", async function () {
      await referralProgram.setReferrals(referralProgramUnits);
      for (let i; i < referralProgramUnits.length; i++) {
        const realReferrals = await referralProgram.getReferralsOf(referralProgramUnits[i].referrer);
        for (let j; j < realReferrals.length; j++) {
          const realReferrer = await referralProgram.referrerOf(realReferrals[j]);
          expect(realReferrer).to.equal(referralProgramUnits[i].referrer);
        }
      }
    });

    it("Should not set a referrer if no referrals provided", async function () {
      const referralProgramUnitsNEW = [
        {
          referrer: referrers[0],
          referrals: [],
        },
        { referrer: referrers[1], referrals: [referrals[2]] },
        { referrer: referrers[2], referrals: [referrals[3], referrals[4], referrals[5]] },
      ];

      await referralProgram.setReferrals(referralProgramUnitsNEW);
      const realReferrers = await referralProgram.getReferrers();
      expect(realReferrers.length).to.equal(2);

      for (let i; i < referralProgramUnitsNEW.length; i++) {
        const realReferrals = await referralProgram.getReferralsOf(referralProgramUnitsNEW[i].referrer);
        if (realReferrals.length > 0) {
          for (let j; j < realReferrals.length; j++) {
            const realReferrer = await referralProgram.referrerOf(realReferrals[j]);
            expect(realReferrer).to.equal(referralProgramUnitsNEW[i].referrer);
          }
        }
      }
    });

    it("Should set referrals for a referrer if only they do not have a parent", async function () {
      await referralProgram.setReferrals(referralProgramUnits);
      const referralsOfBefore = await referralProgram.getReferralsOf(referralProgramUnits[0].referrer);
      expect(referralsOfBefore.length).to.equal(2);
      expect(referralsOfBefore).to.deep.equal([referralProgramUnits[0].referrals[0], referralProgramUnits[0].referrals[1]]);

      const newReferral = referrals[6];
      const referralProgramUnitsNEW = [{ referrer: referrers[0], referrals: [referrals[2], newReferral] }];
      await referralProgram.setReferrals(referralProgramUnitsNEW);

      const referralsOfAfter = await referralProgram.getReferralsOf(referralProgramUnitsNEW[0].referrer);
      expect(referralsOfAfter.length).to.equal(3);
      expect(referralsOfAfter).to.deep.equal([referralProgramUnits[0].referrals[0], referralProgramUnits[0].referrals[1], newReferral]);

      expect(await referralProgram.referrerOf(referrals[2])).to.equal(referrers[1]);
    });
  });
});
