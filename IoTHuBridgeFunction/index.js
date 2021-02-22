//require('dotenv').config({ path: __dirname + '/.env' })
const request = require('request-promise-native');
const handleMessage = require('./lib/engine');

const msiEndpoint = process.env.MSI_ENDPOINT;
const msiSecret = process.env.MSI_SECRET;


if (process.env.AZURE_FUNCTIONS_ENVIRONMENT == "Development") {
    require('dotenv').config({ path: __dirname + '/.env' })
}

const parameters = {
    idScope: process.env.ID_SCOPE,
    primaryKeyUrl: process.env.IOTC_KEY_URL,
    iotcSasKey: process.env.IOTC_SAS_KEY
};


let kvToken;

module.exports = async function (context, IoTHubMessages) {
    try {
        if (!parameters.idScope || !parameters.iotcSasKey || !process.env.IoTHubEventHubConnection) {
            console.log(`Parameters not present. ID_SCOPE: ${parameters.idScope} :: EventHub: ${process.env.IoTHubEventHubConnection} :: IOTC_SAS_KEY: ${parameters.iotcSasKey}`);
            return;
        }

        for (let index = 0; index < IoTHubMessages.length; index++) {
            let deviceID = context.bindingData.systemPropertiesArray[index]["iothub-connection-device-id"];
            let timestamp = context.bindingData.systemPropertiesArray[index]["EnqueuedTimeUtc"];
            let message = IoTHubMessages[index];

            let newMessage = preProcessMessage(message);
            context.log(`Sending: ${JSON.stringify(newMessage)}`);
            await handleMessage({ ...parameters, log: context.log, getSecret: getKeyVaultSecret }, deviceID, newMessage, timestamp);
        }
    }
    catch (ex) {
        context.log.error("Error ocurred!", ex);
    }
}

String.prototype.trimLeft = function(charlist) {
    if (charlist === undefined)
      charlist = "\s";
  
    return this.replace(new RegExp("^[" + charlist + "]+"), "");
  };

  String.prototype.trimRight = function(charlist) {
    if (charlist === undefined)
      charlist = "\s";
  
    return this.replace(new RegExp("[" + charlist + "]+$"), "");
  };

function preProcessMessage(jsonMessage) {
    if (Array.isArray(jsonMessage)) {
        let newArray = [];
        jsonMessage.forEach(element => {
            newArray.push(preProcessSingleElement(element));

        });
        return newArray;
    }
    else {
        return preProcessSingleElement(jsonMessage);
    }
}

function preProcessSingleElement(jsonMessage) {
    let newMessage = {};
    for (let key in jsonMessage) {
        let newKey = key.replace(/[^\w\s]/gi, "_")
                    .trimLeft("_")
                    .trimRight("_");

        newMessage[newKey] = jsonMessage[key];
    }
    return newMessage;
}




async function getKeyVaultSecret(context, secretUrl, forceTokenRefresh = false) {
    return secretUrl;
    if (!kvToken || forceTokenRefresh) {
        const options = {
            uri: `${msiEndpoint}/?resource=https://vault.azure.net&api-version=2017-09-01`,
            headers: { 'Secret': msiSecret },
            json: true
        };

        try {
            context.log('[HTTP] Requesting new Key Vault token');
            const response = await request(options);
            kvToken = response.access_token;
        } catch (e) {
            throw new Error('Unable to get Key Vault token');
        }
    }

    var options = {
        url: `${secretUrl}?api-version=2016-10-01`,
        headers: { 'Authorization': `Bearer ${kvToken}` },
        json: true
    };

    try {
        context.log('[HTTP] Requesting Key Vault secret', secretUrl);
        const response = await request(options);
        return response && response.value;
    } catch (e) {
        if (e.statusCode === 401 && !forceTokenRefresh) {
            return await getKeyVaultSecret(context, secretUrl, true);
        } else {
            throw new Error('Unable to fetch secret');
        }
    }
}