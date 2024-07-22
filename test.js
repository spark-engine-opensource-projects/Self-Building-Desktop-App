
            const { Chart, registerables } = require('chart.js');
            Chart.register(...registerables);

            // Create a new div element
            const newDiv = document.createElement('div');
            newDiv.id = 'chart-container';
            newDiv.style.width = '400px';
            newDiv.style.height = '400px';
            
            const resultElement = document.getElementById('result');
            resultElement.textContent += '
This is inside the executing script';

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
        