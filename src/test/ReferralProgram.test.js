// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getContract,
    getNamedSigners,
    constants: { AddressZero },
    utils: { getAddress, parseEther, hexlify, toUtf8Bytes },
    getContractFactory,
    Wallet,
    getSigner,
  },
  deployments: { fixture },
  upgrades,
} = require("hardhat");
const { eventValidation } = require("./utils/eventValidation");
const makeWalletFromPrivateKey = require("./utils/makeWalletFromPrivateKey.js");
const { generateSignature } = require("./utils/generateSignature.js");
const { deployMockAccessControlUpgradeable } = require("./utils/waffleMocks");

process.env.TEST = true;

describe("ReferralProgram", function () {
  let userAddress;
  let userPrivateKey;
  let deployer, user, user2, user3;
  let registry, referralProgram;
  let snapshotId;
  let mockAccessControlUpgradeable;
  let ErrorsLibrary;
  const message = "Referral link";

  before(async function () {
    await fixture(["Test"]);
    user = makeWalletFromPrivateKey("0x0afb38d6ed610b24ce47c8fb3f844b1f2a0b4aec34a31fd8fbf4df3dd248166f");

    userAddress = `0x${user.getAddress().toString("hex")}`;
    userPrivateKey = user.getPrivateKey().toString("hex");

    ({ deployer, user2, user3 } = await getNamedSigners());
    registry = await getContract("Registry", deployer.address);
    ErrorsLibrary = await getContract("Errors");

    referralProgram = await getContract("ReferralProgram");

    mockAccessControlUpgradeable = await deployMockAccessControlUpgradeable(deployer);
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

  describe("initialize", function () {
    let referralProgramFactory;
    before(async function () {
      referralProgramFactory = await getContractFactory("ReferralProgram");
    });
    it("Should deploy", async function () {
      await upgrades.deployProxy(referralProgramFactory, [registry.address], {
        unsafeAllow: ["constructor", "delegatecall"],
      });
    });
    it("Should revert deploy when registry address not supported", async function () {
      await mockAccessControlUpgradeable.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(referralProgramFactory, [mockAccessControlUpgradeable.address], {
          unsafeAllow: ["constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  it("addReferrals", async function () {
    expect(await referralProgram.getReferralsOf(userAddress)).to.eql([]);
    expect(await referralProgram.referrerOf(user2.address)).to.equal(AddressZero);
    expect(await referralProgram.referrerOf(user3.address)).to.equal(AddressZero);

    const sig = generateSignature(hexlify(toUtf8Bytes(message)), userPrivateKey);

    const tx2 = await referralProgram.connect(user2).register(sig);
    eventValidation("RegisteredUser", await tx2.wait(), [getAddress(user2.address), getAddress(userAddress)]);

    const tx3 = await referralProgram.connect(user3).register(sig);
    eventValidation("RegisteredUser", await tx3.wait(), [getAddress(user3.address), getAddress(userAddress)]);

    expect(await referralProgram.getReferralsOf(userAddress)).to.eql([user2.address, user3.address]);
    expect((await referralProgram.referrerOf(user2.address)).toLowerCase()).to.equal(userAddress);
    expect((await referralProgram.referrerOf(user3.address)).toLowerCase()).to.equal(userAddress);
  });

  it("Should revert if caller is already referral", async function () {
    const sig = generateSignature(hexlify(toUtf8Bytes(message)), userPrivateKey);
    await referralProgram.connect(user2).register(sig);
    const newReferrerWallet = makeWalletFromPrivateKey("0x21d6aef4701a55a6ba02837aac272e53947b73221cf52d26298d656c66820e4e");
    const newReferrerPrivateKey = newReferrerWallet.getPrivateKey().toString("hex");
    const newReferrerSig = generateSignature(hexlify(toUtf8Bytes(message)), newReferrerPrivateKey);

    await expect(referralProgram.connect(user2).register(newReferrerSig)).to.be.revertedWithCustomError(
      ErrorsLibrary,
      "CALLER_ALREADY_REGISTERED",
    );
  });

  it("Should revert if caller is already referrer", async function () {
    const sig = generateSignature(hexlify(toUtf8Bytes(message)), userPrivateKey);
    await referralProgram.connect(user2).register(sig);
    const newReferrerWallet = makeWalletFromPrivateKey("0x21d6aef4701a55a6ba02837aac272e53947b73221cf52d26298d656c66820e4e");
    const newReferrerPrivateKey = newReferrerWallet.getPrivateKey().toString("hex");

    const newReferrerSig = generateSignature(hexlify(toUtf8Bytes(message)), newReferrerPrivateKey);
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [userAddress],
    });
    await network.provider.send("hardhat_setBalance", [userAddress, parseEther("1000").toHexString()]);
    const userSigner = await getSigner(userAddress);

    await expect(referralProgram.connect(userSigner).register(newReferrerSig)).to.be.revertedWithCustomError(
      ErrorsLibrary,
      "CALLER_ALREADY_REGISTERED",
    );
  });

  it("Should revert when referrer address wrong", async function () {
    const sig = generateSignature(hexlify(toUtf8Bytes(message)), userPrivateKey);

    const transactionHash = await user2.sendTransaction({
      to: userAddress,
      value: parseEther("1"),
      gasLimit: 2100000,
    });

    await transactionHash.wait();

    const userSigner = new Wallet(userPrivateKey, user2.provider);
    await expect(referralProgram.connect(userSigner).register(sig, { gasLimit: 2100000 })).to.be.revertedWithCustomError(
      ErrorsLibrary,
      "MISMATCH",
    );
  });

  it("getReferrers", async function () {
    const sig = generateSignature(hexlify(toUtf8Bytes(message)), userPrivateKey);
    await referralProgram.connect(user2).register(sig);
    await referralProgram.connect(user3).register(sig);

    const referrers = await referralProgram.getReferrers();
    expect(referrers.length).to.equal(1);
    expect(referrers[0].toLowerCase()).to.equal(userAddress);
  });
});
