const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function fetchPackageData(prompt) {
    const API_URL = "https://sparkengine.ai/api/engine/completion";
    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: "se-8da20f2f-a737-4d8c-96ff78afe455f5ae",
          ProjectId: "84098539-5f1c-4a3c-9804-d60f1b47cbf9",
          prompt: prompt,
        }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      
      let implementationCode = '';
      let packages = [];

      data.data.forEach(item => {
        if (item.name.startsWith('implementation_code')) {
          implementationCode = item.output.replace(/```.*\n/, '').replace(/```$/, '');
        } else if (item.name.startsWith('packages')) {
          const packageString = item.output.replace(/```.*\n/, '').replace(/```$/, '');
          const packageArrayMatch = packageString.match(/\[.*\]/s); // Use regex to find array
          if (packageArrayMatch) {
            try {
              packages = JSON.parse(packageArrayMatch[0]);
            } catch (error) {
              console.error('Error parsing packages JSON:', error);
              packages = [];
            }
          }
        }
      });

      const result = {
        "packages": packages,
        "implementation_code": implementationCode
      };

      return result;
}

// Function to install a package
function installPackage(packageName, version) {
    return new Promise((resolve, reject) => {
        const child = exec(`npm install ${packageName}${version}`, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });

        child.stdout.on('data', (data) => console.log(data));
        child.stderr.on('data', (data) => console.error(data));
    });
}

// Function to clear require cache for a module
function clearRequireCache(moduleName) {
    const path = require.resolve(moduleName);
    delete require.cache[path];
}

function loadScriptFromClient(scriptUrl) {
    const resultElement = document.getElementById('result');
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    document.body.appendChild(script);
    script.onload = () => {
        resultElement.textContent += '\nScript loaded successfully';
        console.log('Script loaded successfully');
    };
    script.onerror = (error) => {
        resultElement.textContent += '\nError loading the script: ' + error;
        console.error('Error loading the script:', error);
    };
}


// Function to dynamically load and execute code
async function loadAndExecute(packages, implementationCode, scriptPath) {
    const resultElement = document.getElementById('result');

    resultElement.textContent = 'Installing packages and preparing code...\n';

    try {
        // Install packages
        for (const [pkg, version] of Object.entries(packages)) {
            await installPackage(pkg, version);
            clearRequireCache(pkg)
            resultElement.textContent += `${pkg} installed successfully.\n`;
        }

        // Save the implementation code to a file
        fs.writeFileSync(scriptPath, implementationCode);

        // Notify the client to load the script
        loadScriptFromClient(scriptPath);  // This would be a client-side function to load the script
        resultElement.textContent += 'Script loaded and executed!';
    } catch (error) {
        console.error('An error occurred:', error);
        resultElement.textContent += `Error: ${error.message}`;
    } finally {
        spinner.style.display = 'none';
    }
}

document.getElementById('submitPrompt').addEventListener('click', async () => {
    const prompt = document.getElementById("userPrompt").value

    const spinner = document.getElementById('spinner');
    spinner.style.display = 'block';

    const data = await fetchPackageData(prompt);

    const { packages, implementation_code } = data;

    await loadAndExecute(packages, implementation_code, "./test.js");
});
