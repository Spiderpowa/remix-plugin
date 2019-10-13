const { createIframeClient } = remixPlugin
const devMode = { port: 8080 }
const client = createIframeClient({ devMode })

const apikeyStorageKey = 'etherscan-api-key'
function saveAPIkey (e) {
  const value = document.querySelector('input#apikey').value
  localStorage.setItem(apikeyStorageKey, value)
  apikey = value
}
let apikey  = localStorage.getItem(apikeyStorageKey)
if (apikey) document.querySelector('input#apikey').value = apikey

/** Get the current compilation result and make a request to the Ehterscan API */ 
async function getResult() {
  const el = document.querySelector('div#results')
  try {
    el.innerText = 'Getting current compilation result, please wait...'
    await client.onload()
    const compilation = await client.call('solidity', 'getCompilationResult')
    if (!compilation) throw new Error('no compilation result available')
    const fileName = compilation.source.target
    const address = document.querySelector('input[id="verifycontractaddress"]').value
    if (address.trim() === '') {
      throw new Error('Please enter a valid contract address')
    }
    el.innerText = `Verifying contract. Please wait...`
    // fetch results
    const result = await verify(compilation, address, fileName)
    document.querySelector('div#results').innerText = result
  } catch (err) {
    el.innerText = err.message
  }
}

/**
 * Make a POST request to the Etherscan API
 * @param {CompilationResult} compilationResult Result of the compilation 
 * @param {string} address Address of the contract to check
 */
async function verify(compilationResult, address, fileName) {
  const network = await getNetworkName()
  const etherscanApi = (network === 'main')
      ? `https://api-testnet.tangerine.garden/v1/contracts/verify`
      : `https://api-${network}.tangerine.garden/v1/contracts/verify`

  const name = document.getElementById('verifycontractname').value
  let contractMetadata = compilationResult.data.contracts[fileName][name]['metadata']
  contractMetadata = JSON.parse(contractMetadata)
  /*
  const ctrArgument = document.getElementById('verifycontractarguments').value ?
  document.getElementById('verifycontractarguments').value.replace('0x', '') : ''
  */
  const compiler = contractMetadata.compiler.version.split('+commit.')
  if (compiler[0].indexOf('v0.4.') === 0 || compiler[0].indexOf('v0.5.0') === 0) {
    compiler[1] = 'release'
  }
  const data = {
    contract_address: address, //Contract Address starts with 0x...
    source: compilationResult.source.sources[fileName].content, //Contract Source Code (Flattened if necessary)
    contract_name: name, //ContractName
    compiler: `v${compiler[0]}+${compiler[1]}`, // see http://etherscan.io/solcversions for list of support versions
    optimization: contractMetadata.settings.optimizer.enabled ? true : false, //0 = Optimization used, 1 = No Optimization
    runs: contractMetadata.settings.optimizer.runs, //set to 200 as default unless otherwise
    //constructorArguements: ctrArgument, //if applicable
  }

  try {
    client.emit('statusChanged', { key: 'loading', type: 'info', title: 'Verifying ...' })
    const response = await fetch(etherscanApi, { method: 'POST', body: JSON.stringify(data) })
    const result = await response.json()
    let msg = ''
    if (result.success) {
      msg = 'Success'
      // checkValidation(etherscanApi, result)
      scheduleResetStatus()
    } else {
      msg = result.error.error_code
      client.emit('statusChanged', { key: 'failed', type: 'error', title: result })
      scheduleResetStatus()
    }
    return msg
  } catch (error) {
    document.querySelector('div#results').innerText = error
  }
}

/**
 * Check the validity of the result given by Etherscan
 * @param {string} etherscanApi The url of the Etherscan API
 * @param {string} guid ID given back by Etherscan to check the validity of you contract
 */
async function checkValidation (etherscanApi, guid) {
  try {
    const params = `guid=${guid}&module=contract&action=checkverifystatus`
    const response = await fetch(`${etherscanApi}?${params}`, { method: 'GET' })
    let { message, result } = await response.json()
    document.querySelector('div#results').innerText = `${message} ${result}`
    if (message === 'NOTOK' && result === 'Pending in queue') {
      result = await new Promise((res, rej) => setTimeout(() => {
        document.querySelector('div#results').innerText += '. Polling...'
        checkValidation(etherscanApi, guid)
          .then(validityResult => res(validityResult))
          .catch(err => rej(err))
      }, 4000));
    } else  if (message === 'OK') {
      client.emit('statusChanged', { key: 'succeed', type: 'success', title: result + ' Verified!' })
    } else {
      client.emit('statusChanged', { key: 'failed', type: 'error', title: result })
    }
    return result
  } catch (error) {
    document.querySelector('div#results').innerText = error
  }
}

async function getNetworkName() {
  const network = await client.call('network', 'detectNetwork')
  if (!network) {
    throw new Error('no known network to verify against')
  }
  const name = network.name.toLowerCase()
  // TODO : remove that when https://github.com/ethereum/remix-ide/issues/2017 is fixed
  if (name === 'görli') return 'goerli'
  return name
}

/** Reset the status of the plugin to none after 10sec */
function scheduleResetStatus () {
  setTimeout(() => {
    client.emit('statusChanged', { key: 'none' })
  }, 10000)
}
