const express = require("express");
const axios = require("axios");
const { authenticateUser, supabase } = require("../middleware/auth");

const router = express.Router();

// CONFIGURATION MAVIANCE/SMOBILPAY
const MAVIANCE_CONFIG = {
  publicKey: process.env.MAVIANCE_PUBLIC_KEY || "edd2d988-2eed-46cb-a29f-af813cf49087",
  secretKey: process.env.MAVIANCE_SECRET_KEY || "599b94e1-b4bc-4e99-890b-2a346cb8a017",
  baseUrl: process.env.MAVIANCE_BASE_URL || "https://s3p.smobilpay.staging.maviance.info/v2",
  merchantNumber: process.env.MAVIANCE_MERCHANT_NUMBER || "677777777"
};

//  Service IDs pour Maviance (à confirmer avec la documentation)
const SERVICE_IDS = {
  mtn: "6131",  // MTN Mobile Money
  orange: "6132", // Orange Money
  'express-union': "6133" // Express Union
};

//  Fonction pour obtenir le token d'accès Maviance
async function getMavianceAccessToken() {
  try {
    const response = await axios.post(
      `${MAVIANCE_CONFIG.baseUrl}/token`,
      new URLSearchParams({
        'grant_type': 'client_credentials'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${MAVIANCE_CONFIG.publicKey}:${MAVIANCE_CONFIG.secretKey}`).toString('base64')}`
        }
      }
    );
    
    return response.data.access_token;
  } catch (error) {
    console.error(' Erreur obtention token Maviance:', error.response?.data || error.message);
    throw error;
  }
}

//  INITIALISER UN PAIEMENT AVEC MAVIANCE (VERSION CORRIGÉE)
router.post("/initialize", authenticateUser, async (req, res) => {
  console.log("===  INITIALISATION PAIEMENT MAVIANCE ===");

  try {
    const { 
      amount = 1000, 
      phone, 
      payment_method, 
      description = "Abonnement Premium Kamerun News" 
    } = req.body;
    
    const userId = req.user.id;
    const userEmail = req.user.email;

    console.log(`Utilisateur: ${userEmail} (${userId})`);
    console.log(`Téléphone: ${phone}`);
    console.log(`Montant: ${amount} FCFA`);
    console.log(`Méthode: ${payment_method}`);

    // Validation
    if (!phone || phone.length < 9) {
      return res.status(400).json({
        success: false,
        message: "Numéro de téléphone invalide"
      });
    }

    if (!SERVICE_IDS[payment_method]) {
      return res.status(400).json({
        success: false,
        message: "Méthode de paiement non supportée"
      });
    }

    // Générer une référence unique
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 10);
    const reference = `KAM-${timestamp}-${randomStr}`.toUpperCase();

    // Créer l'enregistrement dans Supabase - VERSION SIMPLIFIÉE
    // N'utilise que les colonnes qui existent
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        reference: reference,
        amount: amount,
        currency: "XAF",
        status: "pending",
        // On stocke les autres informations dans un champ texte ou on les ignore
        // Si vous avez une colonne metadata JSONB, utilisez-la :
        metadata: JSON.stringify({
          description: description,
          phone_number: phone,
          payment_method: payment_method,
          user_email: userEmail,
          provider: "maviance",
          created_at: new Date().toISOString()
        })
      })
      .select()
      .single();

    if (txError) {
      console.error(" Erreur création transaction:", txError);
      
      // Tentative alternative sans certaines colonnes
      const { data: simpleTransaction, error: simpleError } = await supabase
        .from("transactions")
        .insert({
          user_id: userId,
          reference: reference,
          amount: amount,
          currency: "XAF",
          status: "pending"
        })
        .select()
        .single();
        
      if (simpleError) {
        return res.status(500).json({
          success: false,
          message: "Erreur création transaction",
          error: simpleError.message
        });
      }
      
      console.log(` Transaction simplifiée créée: ${reference}`);
    } else {
      console.log(` Transaction créée: ${reference}`);
    }

    try {
      // Obtenir le token d'accès
      const accessToken = await getMavianceAccessToken();
      
      // Préparer les données pour Maviance
      const payload = {
        amount: {
          value: amount.toString(),
          currency: "XAF"
        },
        serviceid: SERVICE_IDS[payment_method],
        payer: {
          type: "CUSTOMER",
          id: phone,
          name: req.user.user_metadata?.full_name || userEmail.split('@')[0],
          email: userEmail,
          phone: phone
        },
        orderid: reference,
        description: description,
        merchant: {
          number: MAVIANCE_CONFIG.merchantNumber
        },
        callback_url: `https://severbackendmavicince.onrender.com/api/payments/webhook/maviance`,
        return_url: `https://severbackendmavicince.onrender.com/api/payments/status/${reference}`
      };

      console.log(" Envoi à Maviance API...");

      const response = await axios.post(
        `${MAVIANCE_CONFIG.baseUrl}/collect`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 30000
        }
      );

      const data = response.data;
      console.log(" Réponse Maviance reçue:", data.status);

      // Extraire l'URL de paiement
      const paymentUrl = data.paymentUrl || data.url || data.authorization_url;
      
      if (!paymentUrl) {
        console.error(" Pas d'URL de paiement dans la réponse:", data);
        return res.status(500).json({
          success: false,
          message: "URL de paiement non reçue de Maviance",
          data: data
        });
      }

      console.log(`🔗 URL de paiement: ${paymentUrl.substring(0, 80)}...`);

      return res.json({
        success: true,
        message: "Paiement initialisé avec succès",
        data: {
          reference: reference,
          paymentUrl: paymentUrl,
          status: data.status || "PENDING",
          amount: amount
        }
      });

    } catch (error) {
      console.error(" Erreur API Maviance:", error.message);
      
      if (error.response) {
        console.error(" Détails:", error.response.data);
      }

      return res.status(500).json({
        success: false,
        message: "Erreur lors de l'initialisation du paiement avec Maviance",
        error: error.message,
        details: error.response?.data
      });
    }

  } catch (error) {
    console.error("Erreur globale:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message
    });
  }
});

//  WEBHOOK MAVIANCE (simplifié)
router.post("/webhook/maviance", async (req, res) => {
  console.log("===  WEBHOOK MAVIANCE REÇU ===");
  
  try {
    const payload = req.body;
    console.log(" Données webhook:", JSON.stringify(payload, null, 2));

    const transactionReference = payload.orderid || payload.reference;
    const status = payload.status;

    if (!transactionReference) {
      console.error("Référence manquante dans le webhook");
      return res.status(400).json({ success: false, message: "Référence manquante" });
    }

    console.log(`Traitement webhook: Référence=${transactionReference}, Statut=${status}`);

    // Mettre à jour simplement la transaction
    await supabase
      .from("transactions")
      .update({
        status: status === 'SUCCESSFUL' ? 'completed' : 
                status === 'FAILED' ? 'failed' : 'pending',
        updated_at: new Date().toISOString()
      })
      .eq("reference", transactionReference);

    // Si paiement réussi, activer premium
    if (status === 'SUCCESSFUL') {
      // Trouver l'utilisateur via la transaction
      const { data: transaction } = await supabase
        .from("transactions")
        .select("user_id")
        .eq("reference", transactionReference)
        .single();

      if (transaction && transaction.user_id) {
        await supabase
          .from("profiles")
          .update({
            is_premium: true,
            payment_reference: transactionReference,
            last_payment_date: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", transaction.user_id);
      }
    }

    console.log(`Webhook traité pour ${transactionReference}`);

    return res.status(200).json({ 
      success: true, 
      message: "Webhook traité",
      reference: transactionReference
    });

  } catch (error) {
    console.error(" Erreur traitement webhook:", error);
    return res.status(200).json({ 
      received: true, 
      error: error.message 
    });
  }
});

// VÉRIFIER UN PAIEMENT (simplifié)
router.get("/verify/:reference", authenticateUser, async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;

    console.log(` Vérification paiement: ${reference}`);

    // Chercher la transaction
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("reference", reference)
      .eq("user_id", userId)
      .maybeSingle();

    if (txError || !transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction non trouvée"
      });
    }

    // Retourner le statut
    return res.json({
      success: true,
      paid: transaction.status === 'completed',
      status: transaction.status,
      message: transaction.status === 'completed' ? 
        "Paiement confirmé" : 
        "Paiement en attente"
    });

  } catch (error) {
    console.error(" Erreur vérification:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la vérification"
    });
  }
});

//  CONFIGURATION
router.get("/config", (req, res) => {
  return res.json({
    success: true,
    config: {
      provider: "Maviance SmobilPay",
      mode: process.env.NODE_ENV || 'staging',
      base_url: MAVIANCE_CONFIG.baseUrl,
      webhook_url: "https://severbackendmavicince.onrender.com/api/payments/webhook/maviance",
      supported_methods: Object.keys(SERVICE_IDS),
      status: "ACTIF"
    }
  });
});

module.exports = router;