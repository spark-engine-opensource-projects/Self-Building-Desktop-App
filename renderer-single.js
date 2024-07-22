const { exec } = require('child_process');

document.getElementById('loadPackage').addEventListener('click', () => {
    const spinner = document.getElementById('spinner');
    const resultElement = document.getElementById('result');
    const chartCanvas = document.getElementById('myChart');

    spinner.style.display = 'block';
    resultElement.textContent = 'Installing package...\n';

    const child = exec('npm install chart.js');

    child.stdout.on('data', (data) => {
        resultElement.textContent += data;
    });

    child.stderr.on('data', (data) => {
        resultElement.textContent += data;
    });

    child.on('close', (code) => {
        if (code !== 0) {
            resultElement.textContent += `\nInstallation failed with exit code ${code}`;
            spinner.style.display = 'none';
            return;
        }

        resultElement.textContent += '\nInstallation completed successfully.\n';

        // Dynamically load Chart.js using require
        try {
            delete require.cache[require.resolve('chart.js')]; // Ensure we are loading the latest module
            const { Chart, registerables } = require('chart.js');
            Chart.register(...registerables);

            const ctx = chartCanvas.getContext('2d');
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
                    responsive: false,
                }
            });

            resultElement.textContent += 'Chart.js loaded and chart rendered!';
            spinner.style.display = 'none';
            chartCanvas.style.display = 'block';
        } catch (error) {
            resultElement.textContent += `\nFailed to load Chart.js: ${error.message}`;
            spinner.style.display = 'none';
        }
    });
});
