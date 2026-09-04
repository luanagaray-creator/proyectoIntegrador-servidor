const data = require('../data/paymentDetailsData.js');

function getPaymentDetails(req, res) {
    res.json(data.paymentDetails)
}

function getPaymentDetailById(req, res) {
    const id = parseInt(req.params.id);
    const paymentDetail = data.paymentDetails.find(pd => pd.id === id);
    if (paymentDetail) {
        res.json(paymentDetail);
    } else {
        res.status(404).json({ message: 'Detalle de pago no encontrado' });
    }
}

function createPaymentDetail(req, res) {
    const { usuarioId, tarjeta, fechaExpiracion } = req.body;
    const newPaymentDetail = { id: data.paymentDetails.length + 1, usuarioId, tarjeta, fechaExpiracion };
    data.paymentDetails.push(newPaymentDetail);
    res.status(201).json(newPaymentDetail);
}

function updatePaymentDetail(req, res) {
    const id = parseInt(req.params.id);
    const { usuarioId, tarjeta, fechaExpiracion } = req.body;
    const paymentDetailIndex = data.paymentDetails.findIndex(pd => pd.id === id);
    if (paymentDetailIndex !== -1) {
        data.paymentDetails[paymentDetailIndex] = { ...data.paymentDetails[paymentDetailIndex], usuarioId, tarjeta, fechaExpiracion };
        res.json(data.paymentDetails[paymentDetailIndex]);
    } else {
        res.status(404).json({ message: 'Detalle de pago no encontrado' });
    }
}

function deletePaymentDetail(req, res) {
    const id = parseInt(req.params.id);
    const paymentDetailIndex = data.paymentDetails.findIndex(pd => pd.id === id);
    if (paymentDetailIndex !== -1) {
        data.paymentDetails.splice(paymentDetailIndex, 1);
        res.json({ message: 'Detalle de pago eliminado' });
    } else {
        res.status(404).json({ message: 'Detalle de pago no encontrado' });
    }
}

export { getPaymentDetails, getPaymentDetailById, createPaymentDetail, updatePaymentDetail, deletePaymentDetail };