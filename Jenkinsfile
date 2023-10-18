#!/usr/bin/env groovy


def deployContracts(image, env, network) {
    def vaultPath
    if (( network == 'devnode1' )) {
        vaultPath = "primex-contracts"
    } else if (( network == 'devnode2' )) {
        vaultPath = "primex-contracts-per1"
    } else if (( network == 'devnode3' )) {
        vaultPath = "primex-contracts-per2"
    } else {
        vaultPath = "primex-contracts-${network}"
    }
    withCredentials([string(credentialsId: 'VAULT_CLIENT_TOKEN_FOR_CONTRACTS', variable: 'VAULT_CLIENT_TOKEN')]) {
        withEnv(["VAULT_MODE=print_env_file", "VAULT_SECRET_PATH=${env}/${vaultPath}", "IMAGE=${image}", "NETWORK=${network}"]) {
        sh '''#!/bin/bash
            vclient > env_${NETWORK}
            mkdir ${NETWORK}
            mkdir typechain_${NETWORK}
            if [[ ${NETWORK} == "devnode1" ]]; then
                mkdir htmldocs
                docker run -v `pwd`/env_${NETWORK}:/env/env -v `pwd`/${NETWORK}:/data/deployments/${NETWORK} -v `pwd`/typechain_${NETWORK}:/data/typechain -v `pwd`/htmldocs:/data/htmldocs ${IMAGE}
            else
                docker run -v `pwd`/env_${NETWORK}:/env/env -v `pwd`/${NETWORK}:/data/deployments/${NETWORK} -v `pwd`/typechain_${NETWORK}:/data/typechain ${IMAGE}
            fi
        '''
        }
    }
}

def copyArtifacts(network) {
    def artifactsPath
    if (( network == 'devnode1' )) {
        artifactsPath = "host"
    } else if (( network == 'devnode2' )) {
        artifactsPath = "host-period-1"
    } else if (( network == 'devnode3' )) {
        artifactsPath = "host-period-2"
    } else {
        artifactsPath = network
    }
    withEnv(["NETWORK=${network}", "ARTIFACTS_PATH=${artifactsPath}"]) {
    sh '''#!/bin/bash
        if [[ ${NETWORK} == "devnode1" ]]; then
            rm -rf ./primex_artifacts/develop/abis/*
            cp -r `pwd`/${NETWORK}/* ./primex_artifacts/develop/abis
            cp `pwd`/src/config/${NETWORK}/addresses.json ./primex_artifacts/develop/abis
            rm -rf ./primex_artifacts/develop/typechain/*
            cp -r `pwd`/typechain_${NETWORK}/* ./primex_artifacts/develop/typechain
        fi
        rm -rf ./primex_artifacts/${ARTIFACTS_PATH}/abis/*
        cp -r `pwd`/${NETWORK}/* ./primex_artifacts/${ARTIFACTS_PATH}/abis
        cp `pwd`/src/config/${NETWORK}/addresses.json ./primex_artifacts/${ARTIFACTS_PATH}/abis
        rm -rf ./primex_artifacts/${ARTIFACTS_PATH}/typechain/*
        cp -r `pwd`/typechain_${NETWORK}/* ./primex_artifacts/${ARTIFACTS_PATH}/typechain
    '''
    }
}

node() {
    def isSuccsess = true
    def REVISION
    def TAG
    def SKIP_DEPLOY = false
    def MINOR_VERSION_UPDATE = false
    def MAJOR_VERSION_UPDATE = false
    def ENV_KIND = "develop"
    def NS = "primex-dev"
    def networks = [:]

    try {
        stage('Checkout') {
            deleteDir() // Workdir cleanup
            def scmVars = checkout scm

            REVISION = scmVars.GIT_COMMIT
            BRANCH = scmVars.GIT_BRANCH.take(128-"-${REVISION[0..7]}-${BUILD_NUMBER}".length()) // 128 max tag name
            BRANCH = scmVars.GIT_BRANCH.replace("/", "_")
            if (( env.TAG_NAME )) {
                println("Git tag discovered: ${env.TAG_NAME}")
                TAG = env.TAG_NAME
                PREVIOUS_TAG = sh(returnStdout: true, script: "git tag -l | tail -2 | head -1").trim()
                println("Previous tag: ${PREVIOUS_TAG}")
                PREVIOUS_TAG_MAJOR = PREVIOUS_TAG.split('-')[0]
                CURRENT_TAG_MAJOR = env.TAG_NAME.split('-')[0]                
                CONTRACTS_VERSION = env.TAG_NAME.replace(".", "-")
                PREVIOUS_CONTRACTS_VERSION = PREVIOUS_TAG.replace(".", "-")

                println("Previous tag major version: ${PREVIOUS_TAG_MAJOR}")
                println("Current tag major version: ${CURRENT_TAG_MAJOR}")

                if ((env.TAG_NAME.split('-').length != 1)) {
                    MINOR_VERSION_UPDATE = true
                    networks = [
                        'devnode1',
                        'devnode2',
                        'devnode3'
                    ]
                } else {
                    MAJOR_VERSION_UPDATE = true
                    ENV_KIND = "testnet"
                    NS = "primex-testnet"
                    networks = [
                        'goerly',
                        'matic',
                        'polygonZKtestnet',
                        'moonbaseAlpha'
                    ]
                }
            } else {
                println("No git tags found")
                TAG = "${BRANCH}-${REVISION[0..7]}-${BUILD_NUMBER}"
                SKIP_DEPLOY = true
            }

            println "Git branch: ${BRANCH}"
            println("Image tag: ${TAG}")
        }

        stage('start_notification') {
            slackSend channel: "notifications", message: "${env.JOB_NAME} - #${env.BUILD_NUMBER} Started. Environment: ${ENV_KIND}. Branch: ${BRANCH}. Commit: ${REVISION}"
        }

        stage('Bring Geth keystore') {
            KEYSTORE_NS = "primex-dev"
            
            withCredentials([
                string(credentialsId: 'VAULT_CLIENT_TOKEN', variable: 'VAULT_CLIENT_TOKEN')]) {
                withEnv(["VAULT_SECRET_PATH=infrastructure/jenkins", "KEYSTORE_NS=${KEYSTORE_NS}"]) {
                 sh '''#!/bin/bash
                    export VAULT_OVERRIDE_ENV_AWS_ACCESS_KEY_ID=`vclient printenv AWS_ACCESS_KEY_ID_9284`
                    export VAULT_OVERRIDE_ENV_AWS_SECRET_ACCESS_KEY=`vclient printenv AWS_SECRET_ACCESS_KEY_9284`
                    vclient aws eks --region us-east-1  update-kubeconfig --name eks-02
                    vclient kubectl -n ${KEYSTORE_NS} cp geth-0:/data/node/keystore ./src/keystore
                '''
                }
            }
        }

        if (( !env.TAG_NAME )) {
            stage('Build and run tests') {
                try {
                    withCredentials([
                        string(credentialsId: 'VAULT_CLIENT_TOKEN_FOR_CONTRACTS', variable: 'VAULT_CLIENT_TOKEN'),
                        sshUserPrivateKey(credentialsId: "id_rsa_primex_mirin_git", keyFileVariable: 'keyfile')]) {
                        withEnv(["VAULT_SECRET_PATH=develop/primex-contracts", "TAG=${TAG}"]) {
                        sh '''#!/bin/bash
                            export SSH_KEY="$(cat ${keyfile})"
                            mkdir coverage
                            touch coverage.json
                            touch cobertura-coverage.xml
                            vclient skaffold build -p build-and-test-no-push --file-output=tags.json
                            vclient skaffold test -p build-and-test-no-push --build-artifacts=tags.json
                        '''
                        }
                        def TEST_SUMMARY = sh(script: 'grep -A 20 -B 3 "Done in" test_results.txt', returnStdout: true)               
                        slackSend channel: "notifications", color: "good", message: "${env.JOB_NAME} - #${env.BUILD_NUMBER} Tests passed successfully. Environment: ${ENV_KIND}. Branch: ${BRANCH}. Commit: ${REVISION}\nSummary: ${TEST_SUMMARY}"
                        discoverGitReferenceBuild()
                        recordCoverage(tools: [[parser: 'COBERTURA', pattern: '**/cobertura-coverage.xml']],
                            id: 'cobertura', name: 'Cobertura Coverage',
                            sourceCodeRetention: 'LAST_BUILD',
                            sourceDirectories: [[path: './src']],
                            skipPublishingChecks: false,
                            checksName: 'Code Coverage',
                            checksAnnotationScope: 'MODIFIED_LINES',
                            qualityGates: [
                                [threshold: 60.0, metric: 'LINE', baseline: 'PROJECT', criticality : 'UNSTABLE'],
                                [threshold: 60.0, metric: 'BRANCH', baseline: 'PROJECT', criticality : 'UNSTABLE']
                            ]
                        )
                    }
                } catch (ex) {
                    def TEST_SUMMARY = sh(script: 'grep -A 20 -B 3 "Done in" test_results.txt', returnStdout: true)
                    slackSend channel: "notifications", color: "danger", message: "${env.JOB_NAME} - #${env.BUILD_NUMBER} Tests failed. Environment: ${ENV_KIND}. Branch: ${BRANCH}. Commit: ${REVISION}\nSummary: ${TEST_SUMMARY}"
                    sh "docker-compose logs hardhat"
                    isSuccsess = false
                    currentBuild.result = 'FAILURE'
                    error "Build does not pass tests"
                } finally {
                    sh "docker-compose down"
                    def TEST_RES = sh(script: 'cat test_results.txt', returnStdout: true)
                    println TEST_RES
                }
            }
        }

        if (( env.TAG_NAME )) {
            stage('Build new version') {
                withCredentials([
                    string(credentialsId: 'VAULT_CLIENT_TOKEN', variable: 'VAULT_CLIENT_TOKEN'),
                    sshUserPrivateKey(credentialsId: "id_rsa_primex_mirin_git", keyFileVariable: 'keyfile')]) {
                    withEnv(["VAULT_SECRET_PATH=infrastructure/jenkins", "TAG=${TAG}", "MAJOR_VERSION_UPDATE=${MAJOR_VERSION_UPDATE}", "CONTRACTS_VERSION=${CONTRACTS_VERSION}"]) {
                        sh '''#!/bin/bash
                            export VAULT_OVERRIDE_ENV_AWS_ACCESS_KEY_ID=`vclient printenv AWS_ACCESS_KEY_ID_9284`
                            export VAULT_OVERRIDE_ENV_AWS_SECRET_ACCESS_KEY=`vclient printenv AWS_SECRET_ACCESS_KEY_9284`
                            vclient aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 169602129284.dkr.ecr.us-east-1.amazonaws.com
                            export SSH_KEY="$(cat ${keyfile})"
                            if ${MAJOR_VERSION_UPDATE} ; then 
                                vclient skaffold build -p version-deploy-testnet --file-output=tags.json
                            else
                                vclient skaffold build -p version-deploy-develop --file-output=tags.json
                            fi
                        '''
                    }              
                }
            }

            stage('Deploy new version') {
                def IMAGE = sh(script: """jq .builds[0].tag tags.json | cut -d'"' -f2""", returnStdout: true)
                def stepsForParallel = [:]
                networks.each {
                    def stepName = "Deploy contracts to ${it} network"
                    stepsForParallel[stepName] = { -> 
                        deployContracts(IMAGE, ENV_KIND, it)
                    }
                }

                parallel stepsForParallel
            }
        }

        stage('Sync artifacts in repo') {
            if (( SKIP_DEPLOY == true)) {
                println("Sync artifacts skipped")
            } else {
                withCredentials([sshUserPrivateKey(credentialsId: "id_rsa_primex_artifacts_git", keyFileVariable: 'SSH_KEY')]) {
                    withEnv(["VAULT_SECRET_PATH=infrastructure/jenkins", "GIT_SSH_COMMAND=ssh -oStrictHostKeyChecking=no -i ${SSH_KEY}", "ENV_KIND=${ENV_KIND}", "CONTRACTS_VERSION=${TAG}"]) {
                        sh '''#!/bin/bash
                        git clone git@github.com:primex-finance/primex_artifacts.git
                        '''

                        def stepsForParallel = [:]
                        networks.each {
                            def stepName = "Copy artifacts for ${it} network"
                            stepsForParallel[stepName] = { -> 
                                copyArtifacts(it)
                            }
                        }

                        parallel stepsForParallel

                        sh '''#!/bin/bash                        
                        cd ./primex_artifacts
                        git add . && git commit -am "Jenkins CI artifacts updates"
                        git push

                        if [ ${CONTRACTS_VERSION} != "" ]; then
                            git tag ${CONTRACTS_VERSION}
                            git push --tags
                        fi
                        '''
                    }
                }
            }
        }  

    } catch (ex) {
        isSuccsess = false
        currentBuild.result = 'FAILURE'
    }

    finally {
        def IMAGE = sh(script: """jq .builds[0].tag tags.json | cut -d'"' -f2""", returnStdout: true)
        withEnv(["IMAGE=${IMAGE}"]) {
            sh '''#!/bin/bash
            docker image rm ${IMAGE}
            if [ -d `pwd`/htmldocs ]; then
                rm -rf `pwd`/htmldocs
            fi
            if [ -d `pwd`/coverage ]; then
                sudo chown -R ubuntu:ubuntu `pwd`/coverage
            fi            
            '''
        }
        networks.each {
            withEnv(["dir=${it}"]) {
                sh '''#!/bin/bash
                if [ -d `pwd`/${dir} ]; then
                    sudo rm -rf `pwd`/${dir}
                    sudo rm -rf `pwd`/typechain_${dir}
                fi
                '''
            }
        }
        if (( !isSuccsess )) {
            slackSend channel: "notifications", color: "danger", message: "${env.JOB_NAME} - #${env.BUILD_NUMBER} Failure. Environment: ${ENV_KIND}. Branch: ${BRANCH}. Commit: ${REVISION}"
        } else {
            slackSend channel: "notifications", color: "good", message: "${env.JOB_NAME} - #${env.BUILD_NUMBER} Success. Environment: ${ENV_KIND}. Branch: ${BRANCH}. Commit: ${REVISION}"
        }
    }
}
