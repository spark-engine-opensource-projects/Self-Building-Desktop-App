const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// async function fetchPackageData(prompt) {
//     const API_URL = "https://sparkengine.ai/api/engine/completion"
//     const response = await fetch(API_URL, {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           apiKey: "",
//           ProjectId: "",
//           prompt: prompt,
//         }),
//       });

//       if (!response.ok) {
//         throw new Error(`Error: ${response.status}`);
//       }

//       const data = await response.json();
//       console.log(data);
//       return data
// }

async function fetchPackageData(prompt) {
    return {
        "packages": {
            "chart.js": "@3.7.0"
        },
        "implementation_code": `
            const { Chart, registerables } = require('chart.js');
            // console.log(registerables)
            // Chart.register(...registerables);
            
            // Create a new div element
            const newDiv = document.createElement('div');
            newDiv.id = 'chart-container';
            newDiv.style.width = '400px';
            newDiv.style.height = '400px';
            
            const resultElement = document.getElementById('result');
            resultElement.textContent += 'This is inside the executing script';

            // Create a canvas element and append it to the new div
            const canvas = document.createElement('canvas');
            canvas.id = 'myNewChart';
            canvas.width = 400;
            canvas.height = 400;
            newDiv.appendChild(canvas);

            // Append the new div to the body of the document
            document.body.appendChild(newDiv);

            // Context for the new chart
            const ctx = canvas.getContext('2d');
            const myChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'],
                    datasets: [{
                        label: '# of Votes',
                        data: [12, 19, 3, 5, 2, 3],
                        backgroundColor: [
                            'rgba(255, 99, 132, 0.2)',
                            'rgba(54, 162, 235, 0.2)',
                            'rgba(255, 206, 86, 0.2)',
                            'rgba(75, 192, 192, 0.2)',
                            'rgba(153, 102, 255, 0.2)',
                            'rgba(255, 159, 64, 0.2)'
                        ],
                        borderColor: [
                            'rgba(255, 99, 132, 1)',
                            'rgba(54, 162, 235, 1)',
                            'rgba(255, 206, 86, 1)',
                            'rgba(75, 192, 192, 1)',
                            'rgba(153, 102, 255, 1)',
                            'rgba(255, 159, 64, 1)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true
                }
            });
            console.log('New div created, chart rendered!');
        `
    }

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
    const spinner = document.getElementById('spinner');
    const resultElement = document.getElementById('result');

    spinner.style.display = 'block';
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
    const data = await fetchPackageData(prompt);
    const { packages, implementation_code } = data;
    await loadAndExecute(packages, implementation_code, "./test.js");
});
