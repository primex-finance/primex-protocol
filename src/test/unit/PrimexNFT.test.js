// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  upgrades,
  ethers: {
    provider,
    getContract,
    getContractAt,
    getContractFactory,
    getSigners,
    utils: { keccak256, toUtf8Bytes },
  },

  deployments: { fixture },
} = require("hardhat");
const { signPrimexMintData, recoverSignerOfPrimexNftMintData } = require("../utils/generateSignature.js");

process.env.TEST = true;

const { deployMockAccessControl } = require("../utils/waffleMocks");
describe("PrimexNFT_unit", function () {
  let deployer, user, caller;
  let PrimexNFT, mockRegistry;
  let snapshotId;
  let mintParams, signature, NFT_MINTER;
  let ErrorsLibrary;
  const tokenID = 0;

  before(async function () {
    await fixture(["Errors", "PrimexProxyAdmin"]);
    ErrorsLibrary = await getContract("Errors");
    [deployer, user, caller] = await getSigners();
    mockRegistry = await deployMockAccessControl(deployer);

    NFT_MINTER = keccak256(toUtf8Bytes("NFT_MINTER"));

    const deploymentPMXBonusNFT = await run("deploy:PrimexNFT", {
      deploymentName: "PrimexNFT",
      registry: mockRegistry.address,
      name: "Test Name",
      symbol: "TEST",
      baseURI: "primex/",
    });

    PrimexNFT = await getContractAt("PrimexNFT", deploymentPMXBonusNFT.address);

    mintParams = {
      chainId: network.config.chainId,
      id: tokenID,
      recipient: deployer.address,
      deadline: (await provider.getBlock("latest")).timestamp + 100,
    };

    signature = await signPrimexMintData(deployer, mintParams);
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
    it("Should revert deploy if registry does not support interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      const pmxBonusNftFactory = await getContractFactory("PrimexNFT");
      await expect(
        upgrades.deployProxy(pmxBonusNftFactory, [mockRegistry.address, "Test Name", "Test", ""], {
          unsafeAllow: ["constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });
  describe("mint with signature", function () {
    it("Should mint and returns the correct meta data and minter's balanceOf", async function () {
      await PrimexNFT["mint(bytes,(uint256,uint256,address,uint256))"](signature, mintParams);
      expect(await PrimexNFT.balanceOf(deployer.address)).to.be.equal(1);
      expect(await PrimexNFT.ownerOf(tokenID)).to.be.equal(deployer.address);
      expect(await PrimexNFT.idToDeadLine(tokenID)).to.be.equal(mintParams.deadline);
    });
    it("Should mint NFT to recipient when message sender isn't recipient", async function () {
      await PrimexNFT.connect(user)["mint(bytes,(uint256,uint256,address,uint256))"](signature, mintParams);
      expect(await PrimexNFT.balanceOf(deployer.address)).to.be.equal(1);
      expect(await PrimexNFT.ownerOf(tokenID)).to.be.equal(deployer.address);
      expect(await PrimexNFT.idToDeadLine(tokenID)).to.be.equal(mintParams.deadline);
    });

    it("Should revert mint when message signer doesn't have NFT_MINTER role", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, user.address).returns(false);

      const badSignature = await signPrimexMintData(user, mintParams);
      await expect(
        PrimexNFT.connect(user)["mint(bytes,(uint256,uint256,address,uint256))"](badSignature, mintParams),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert mint when message isn't that owner sign", async function () {
      const badMintParams = { ...mintParams };
      badMintParams.id = 200;

      const recoveredAddress = recoverSignerOfPrimexNftMintData(signature, badMintParams);
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, recoveredAddress).returns(false);

      await expect(PrimexNFT["mint(bytes,(uint256,uint256,address,uint256))"](signature, badMintParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert mint when chainId doesn't match", async function () {
      const mintParamsForOtherNetwork = { ...mintParams };
      mintParamsForOtherNetwork.chainId = 200;
      const signaturForOtherNetworke = await signPrimexMintData(deployer, mintParamsForOtherNetwork);
      await expect(
        PrimexNFT["mint(bytes,(uint256,uint256,address,uint256))"](signaturForOtherNetworke, mintParamsForOtherNetwork),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "WRONG_NETWORK");
    });
    it("Should revert double mint by one signature", async function () {
      await PrimexNFT["mint(bytes,(uint256,uint256,address,uint256))"](signature, mintParams);
      await expect(PrimexNFT["mint(bytes,(uint256,uint256,address,uint256))"](signature, mintParams)).to.be.revertedWith(
        "ERC721: token already minted",
      );
    });
  });

  describe("mint by minter", function () {
    it("Should mint and returns the correct meta data and recipient balanceOf", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(true);
      await PrimexNFT["mint((uint256,uint256,address,uint256))"](mintParams);
      expect(await PrimexNFT.balanceOf(deployer.address)).to.be.equal(1);
      expect(await PrimexNFT.ownerOf(tokenID)).to.be.equal(deployer.address);
      expect(await PrimexNFT.idToDeadLine(tokenID)).to.be.equal(mintParams.deadline);
    });

    it("Should revert mint when msg.sender isn't minter", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(false);
      await expect(PrimexNFT["mint((uint256,uint256,address,uint256))"](mintParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert mint when chainId doesn't match", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(true);
      const mintParamsForOtherNetwork = { ...mintParams };
      mintParamsForOtherNetwork.chainId = 200;
      await expect(PrimexNFT["mint((uint256,uint256,address,uint256))"](mintParamsForOtherNetwork)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "WRONG_NETWORK",
      );
    });
    it("Should revert double mint with the same id", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(true);

      await PrimexNFT["mint((uint256,uint256,address,uint256))"](mintParams);
      await expect(PrimexNFT["mint((uint256,uint256,address,uint256))"](mintParams)).to.be.revertedWith("ERC721: token already minted");
    });
  });
  describe("mintBatch by minter", function () {
    it("Should mint and returns the correct meta data and recipient balanceOf", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(true);
      await PrimexNFT.mintBatch([mintParams]);
      expect(await PrimexNFT.balanceOf(deployer.address)).to.be.equal(1);
      expect(await PrimexNFT.ownerOf(tokenID)).to.be.equal(deployer.address);
      expect(await PrimexNFT.idToDeadLine(tokenID)).to.be.equal(mintParams.deadline);
    });

    it("Should revert mint when msg.sender isn't minter", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, deployer.address).returns(false);
      await expect(PrimexNFT.mintBatch([mintParams])).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });

  describe("haveUsersActiveTokens", function () {
    it("Should revert double mint with the same id", async function () {
      await PrimexNFT["mint(bytes,(uint256,uint256,address,uint256))"](signature, mintParams);

      expect(await PrimexNFT.idToDeadLine(mintParams.id)).to.be.greaterThan((await provider.getBlock("latest")).timestamp);
      const returnData = await PrimexNFT.haveUsersActiveTokens([deployer.address, user.address, caller.address]);
      expect(returnData[0]).to.be.equal(true);
      expect(returnData[1]).to.be.equal(false);
      expect(returnData[2]).to.be.equal(false);
    });
  });

  describe("batchSetDeadline", function () {
    before(async function () {
      // await PrimexNFT["mint((uint256,uint256,address,uint256))"](mintParams);
      await PrimexNFT["mint((uint256,uint256,address,uint256))"](mintParams);
      await PrimexNFT["mint((uint256,uint256,address,uint256))"]({ ...mintParams, id: 1 });
    });
    it("Should revert when params length mismatch", async function () {
      await expect(PrimexNFT.batchSetDeadline([0, 1], [0])).to.be.revertedWithCustomError(ErrorsLibrary, "PARAMS_LENGTH_MISMATCH");
    });
    it("Should revert when the caller is not an NFT_MINTER_ROLE", async function () {
      await mockRegistry.mock.hasRole.withArgs(NFT_MINTER, user.address).returns(false);

      await expect(PrimexNFT.connect(user).batchSetDeadline([0, 1], [0, 0])).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should batchSetDeadline fot the two tokens", async function () {
      expect(await PrimexNFT.idToDeadLine(0)).to.be.equal(mintParams.deadline);
      expect(await PrimexNFT.idToDeadLine(1)).to.be.equal(mintParams.deadline);
      const deadlineForFirstToken = mintParams.deadline + 1;
      const deadlineForSecondToken = mintParams.deadline + 2;
      await PrimexNFT.batchSetDeadline([0, 1], [deadlineForFirstToken, deadlineForSecondToken]);

      expect(await PrimexNFT.idToDeadLine(0)).to.be.equal(deadlineForFirstToken);
      expect(await PrimexNFT.idToDeadLine(1)).to.be.equal(deadlineForSecondToken);
    });
  });
});
