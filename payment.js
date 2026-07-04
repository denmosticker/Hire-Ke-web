const API_BASE_URL = 'http://localhost:3000/api';

async function submitPayment() {
    const phone = document.getElementById('mpesaPhone').value.trim();
    const token = localStorage.getItem('token');

    if (!phone) {
        alert('Please enter the M-Pesa phone number for the STK Push.');
        return;
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
        const response = await fetch(`${API_BASE_URL}/payments/stk-push`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                itemCode: currentPackage.itemCode,
                phone: phone
            })
        });

        const data = await response.json();

        if (response.ok) {
            alert(data.message);
            window.location.href = 'recruiter-dashboard.html';
        } else {
            alert(data.error || 'Submission failed');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send STK Push';
        }
    } catch (error) {
        alert('Error connecting to server. Please try again.');
        submitBtn.disabled = false;
    }
}
