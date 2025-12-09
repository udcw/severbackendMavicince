const express = require("express");
const axios = require("axios");
const { authenticateUser, supabase } = require("../middleware/auth");

const router = express.Router();

// 🔥 CONFIGURATION MAVIANCE/SMOBILPAY
const MAVIANCE_CONFIG = {
  publicKey: process.env.MAVIANCE_PUBLIC_KEY || "edd2d988-2eed-46cb-a29f-af813cf49087",
  secretKey: process.env.MAVIANCE_SECRET_KEY || "599b94e1-b4bc-4e99-890b-2a346cb8a017",
  baseUrl: process.env.MAVIANCE_BASE_URL || "https://s3p.smobilpay.staging.maviance.info/v2",
  merchantNumber: process.env.MAVIANCE_MERCHANT_NUMBER || "677777777"
};

// 🔥 Service IDs pour différents opérateurs (à confirmer avec Maviance)
const SERVICE_IDS = {
  mtn: "6131",  // À remplacer avec les vrais IDs
  orange: "6132",
  'express-union': "6133"
};

// 🔥 Fonction pour obtenir le token d'accès Maviance
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
    console.error('❌ Erreur obtention token Maviance:', error.response?.data || error.message);
    throw error;
  }
}

// 🔥 INITIALISER UN PAIEMENT AVEC MAVIANCE
router.post("/initialize", authenticateUser, async (req, res) => {
  console.log("=== 🚀 INITIALISATION PAIEMENT MAVIANCE ===");

  try {
    const { 
      amount = 1000, 
      phone, 
      payment_method, 
      description = "Abonnement Premium Kamerun News" 
    } = req.body;
    
    const userId = req.user.id;
    const userEmail = req.user.email;

    console.log(`👤 Utilisateur: ${userEmail} (${userId})`);
    console.log(`📞 Téléphone: ${phone}`);
    console.log(`💰 Montant: ${amount} FCFA`);
    console.log(`📱 Méthode: ${payment_method}`);

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

    // Créer l'enregistrement dans Supabase
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        reference: reference,
        amount: amount,
        currency: "XAF",
        status: "pending",
        payment_method: payment_method,
        phone_number: phone,
        description: description,
        metadata: {
          user_email: userEmail,
          provider: "maviance",
          created_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (txError) {
      console.error("❌ Erreur création transaction:", txError);
      return res.status(500).json({
        success: false,
        message: "Erreur création transaction",
        error: txError.message
      });
    }

    console.log(`✅ Transaction créée: ${reference}`);

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

      console.log("📤 Envoi à Maviance API...");

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
      console.log("✅ Réponse Maviance reçue:", data.status);

      // Mettre à jour la transaction avec la réponse
      await supabase
        .from("transactions")
        .update({
          metadata: {
            ...transaction.metadata,
            maviance_response: data,
            payment_url: data.paymentUrl || data.url,
            updated_at: new Date().toISOString()
          }
        })
        .eq("id", transaction.id);

      return res.json({
        success: true,
        message: "Paiement initialisé avec succès",
        data: {
          reference: reference,
          paymentUrl: data.paymentUrl || data.url,
          status: data.status || "PENDING",
          transaction_id: transaction.id,
          amount: amount
        }
      });

    } catch (error) {
      console.error("❌ Erreur API Maviance:", error.message);
      
      if (error.response) {
        console.error("📡 Détails:", error.response.data);
      }

      // Mettre à jour le statut en erreur
      await supabase
        .from("transactions")
        .update({
          status: "failed",
          metadata: {
            ...transaction.metadata,
            error: error.message,
            maviance_error: error.response?.data
          }
        })
        .eq("id", transaction.id);

      return res.status(500).json({
        success: false,
        message: "Erreur lors de l'initialisation du paiement",
        error: error.message,
        details: error.response?.data
      });
    }

  } catch (error) {
    console.error("❌ Erreur globale:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message
    });
  }
});

// 🔥 WEBHOOK MAVIANCE
router.post("/webhook/maviance", async (req, res) => {
  console.log("=== 📩 WEBHOOK MAVIANCE REÇU ===");
  
  try {
    const payload = req.body;
    console.log("📦 Données webhook:", JSON.stringify(payload, null, 2));

    // Vérifier la signature du webhook (si Maviance en fournit une)
    // À implémenter selon la documentation Maviance

    const transactionReference = payload.orderid || payload.reference;
    const status = payload.status;
    const transactionId = payload.transactionid;

    if (!transactionReference) {
      console.error("❌ Référence manquante dans le webhook");
      return res.status(400).json({ success: false, message: "Référence manquante" });
    }

    console.log(`🔍 Traitement webhook: Référence=${transactionReference}, Statut=${status}`);

    // Chercher la transaction
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("reference", transactionReference)
      .maybeSingle();

    if (txError) {
      console.error("❌ Erreur recherche transaction:", txError);
    }

    if (!transaction) {
      console.log(`⚠️ Transaction non trouvée: ${transactionReference}`);
      return res.status(200).json({ 
        received: true, 
        message: "Transaction non trouvée mais webhook reçu" 
      });
    }

    console.log(`✅ Transaction trouvée: ${transaction.id}, utilisateur: ${transaction.user_id}`);

    // Mettre à jour la transaction
    const newStatus = status === 'SUCCESSFUL' ? 'completed' : 
                     status === 'FAILED' ? 'failed' : 
                     status === 'PENDING' ? 'pending' : status;

    await supabase
      .from("transactions")
      .update({
        status: newStatus,
        metadata: {
          ...transaction.metadata,
          webhook_data: payload,
          webhook_received_at: new Date().toISOString(),
          maviance_transaction_id: transactionId
        },
        updated_at: new Date().toISOString(),
        completed_at: status === 'SUCCESSFUL' ? new Date().toISOString() : null
      })
      .eq("id", transaction.id);

    // Si paiement réussi, activer premium
    if (status === 'SUCCESSFUL' || status === 'COMPLETED') {
      await processPremiumActivation(transaction.user_id, transactionReference, status);
    }

    console.log(`✅ Webhook traité pour ${transactionReference}`);

    return res.status(200).json({ 
      success: true, 
      message: "Webhook traité avec succès",
      reference: transactionReference,
      status: status
    });

  } catch (error) {
    console.error("❌ Erreur traitement webhook:", error);
    return res.status(200).json({ 
      received: true, 
      error: error.message 
    });
  }
});

// 🔥 VÉRIFIER UN PAIEMENT
router.get("/verify/:reference", authenticateUser, async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;

    console.log(`🔍 Vérification paiement: ${reference} pour ${userId}`);

    // 1. Chercher la transaction
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("reference", reference)
      .eq("user_id", userId)
      .maybeSingle();

    if (txError) {
      console.error("❌ Erreur recherche transaction:", txError);
      return res.status(500).json({
        success: false,
        message: "Erreur base de données"
      });
    }

    if (!transaction) {
      console.log(`⚠️ Transaction ${reference} non trouvée`);
      return res.status(404).json({
        success: false,
        message: "Transaction non trouvée"
      });
    }

    console.log(`✅ Transaction trouvée, statut: ${transaction.status}`);

    // 2. Si déjà complet, retourner
    if (transaction.status === 'completed' || transaction.status === 'success') {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_premium")
        .eq("id", userId)
        .single();

      return res.json({
        success: true,
        paid: true,
        pending: false,
        status: "completed",
        is_premium: profile?.is_premium || false,
        message: "Paiement confirmé"
      });
    }

    // 3. Si en attente, vérifier avec Maviance
    try {
      const accessToken = await getMavianceAccessToken();
      
      const response = await axios.get(
        `${MAVIANCE_CONFIG.baseUrl}/transactions/${reference}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          },
          timeout: 10000
        }
      );

      const data = response.data;
      const mavianceStatus = data.status;
      
      console.log(`📊 Statut Maviance: ${mavianceStatus}`);

      // Mettre à jour la transaction
      const newStatus = mavianceStatus === 'SUCCESSFUL' ? 'completed' : 
                       mavianceStatus === 'PENDING' ? 'pending' : 
                       mavianceStatus === 'FAILED' ? 'failed' : 'unknown';

      await supabase
        .from("transactions")
        .update({
          status: newStatus,
          metadata: {
            ...transaction.metadata,
            last_verification: new Date().toISOString(),
            maviance_status: mavianceStatus
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", transaction.id);

      // Si paiement réussi, activer premium
      if (mavianceStatus === 'SUCCESSFUL' || mavianceStatus === 'COMPLETED') {
        await processPremiumActivation(userId, reference, mavianceStatus);
        
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_premium")
          .eq("id", userId)
          .single();

        return res.json({
          success: true,
          paid: true,
          pending: false,
          status: "completed",
          is_premium: profile?.is_premium || false,
          message: "Paiement confirmé via Maviance"
        });
      }

      // Statut en attente
      if (mavianceStatus === 'PENDING') {
        return res.json({
          success: true,
          paid: false,
          pending: true,
          status: "pending",
          message: "Paiement en attente chez Maviance"
        });
      }

      // Statut échoué
      if (mavianceStatus === 'FAILED' || mavianceStatus === 'CANCELLED') {
        return res.json({
          success: false,
          paid: false,
          pending: false,
          status: "failed",
          message: "Paiement échoué"
        });
      }

      return res.json({
        success: true,
        paid: false,
        pending: true,
        status: mavianceStatus || "unknown",
        message: "Statut indéterminé"
      });

    } catch (mavianceError) {
      console.error("❌ Erreur vérification Maviance:", mavianceError.message);
      
      return res.json({
        success: true,
        paid: false,
        pending: true,
        status: 'pending',
        message: "En attente de confirmation Maviance"
      });
    }

  } catch (error) {
    console.error("❌ Erreur vérification:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la vérification",
      error: error.message
    });
  }
});

// 🔥 FONCTION D'ACTIVATION PREMIUM (inchangée)
async function processPremiumActivation(userId, reference, status) {
  try {
    console.log(`🔄 Activation premium pour: ${userId}, référence: ${reference}`);
    
    if (!userId || userId === "unknown") {
      console.error("❌ ID utilisateur manquant");
      return false;
    }

    // 1. Mettre à jour le profil
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        is_premium: true,
        payment_reference: reference,
        last_payment_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          premium_activated_via: "maviance_webhook",
          activation_date: new Date().toISOString(),
          payment_status: status,
          payment_provider: "maviance"
        }
      })
      .eq("id", userId);

    if (profileError) {
      console.error("❌ Erreur mise à jour profil:", profileError);
      
      // Tentative alternative
      await supabase
        .from("profiles")
        .update({
          is_premium: true,
          payment_reference: reference,
          last_payment_date: new Date().toISOString()
        })
        .eq("id", userId);
    }

    // 2. Vérifier la mise à jour
    const { data: updatedProfile } = await supabase
      .from("profiles")
      .select("is_premium, email")
      .eq("id", userId)
      .single();

    console.log(`✅ Profil ${updatedProfile?.email || userId} mis à jour: is_premium=${updatedProfile?.is_premium}`);

    // 3. Créer un enregistrement d'abonnement
    try {
      await supabase
        .from("subscriptions")
        .insert({
          user_id: userId,
          plan: "premium",
          status: "active",
          transaction_reference: reference,
          starts_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          metadata: {
            activated_via: "maviance",
            activation_date: new Date().toISOString()
          }
        });
      
      console.log(`✅ Abonnement créé pour ${userId}`);
    } catch (subError) {
      console.log("⚠️ Erreur création abonnement:", subError.message);
    }

    return true;

  } catch (error) {
    console.error("❌ Erreur activation premium:", error);
    return false;
  }
}

// 🔥 CONFIGURATION
router.get("/config", (req, res) => {
  return res.json({
    success: true,
    config: {
      provider: "Maviance SmobilPay",
      mode: process.env.NODE_ENV || 'staging',
      base_url: MAVIANCE_CONFIG.baseUrl,
      webhook_url: "https://severbackendnotchpay.onrender.com/api/payments/webhook/maviance",
      supported_methods: Object.keys(SERVICE_IDS),
      status: "ACTIF",
      message: "Système de paiement Maviance opérationnel"
    }
  });
});

// 🔥 STATUT D'UN UTILISATEUR
router.get("/user-status/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Non autorisé"
      });
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("is_premium, payment_reference, last_payment_date, email")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("❌ Erreur recherche profil:", error);
      return res.status(404).json({
        success: false,
        message: "Profil non trouvé"
      });
    }

    return res.json({
      success: true,
      is_premium: profile.is_premium || false,
      payment_reference: profile.payment_reference,
      last_payment_date: profile.last_payment_date,
      email: profile.email,
      provider: "maviance"
    });

  } catch (error) {
    console.error("❌ Erreur vérification statut:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;