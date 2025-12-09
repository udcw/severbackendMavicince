const express = require("express");
const axios = require("axios");
const { authenticateUser, supabase } = require("../middleware/auth");

const router = express.Router();

// 🔥 CONFIGURATION MAVIANCE/SMOBILPAY (CLÉS DE TEST)
const MAVIANCE_CONFIG = {
  publicKey: process.env.MAVIANCE_PUBLIC_KEY,
  secretKey: process.env.MAVIANCE_SECRET_KEY,
  baseUrl: process.env.MAVIANCE_BASE_URL || "https://s3p.smobilpay.staging.maviance.info/v2",
  merchantNumber: process.env.MAVIANCE_MERCHANT_NUMBER || "677777777"
};

// 🔥 Service IDs pour Maviance STAGING (selon la documentation)
const SERVICE_IDS = {
  mtn: "6131",      // MTN Mobile Money (test)
  orange: "6132",   // Orange Money (test)
  'express-union': "6133" // Express Union (test)
};

// 🔥 Fonction pour obtenir le token d'accès Maviance (version optimisée)
async function getMavianceAccessToken() {
  try {
    const authString = Buffer.from(`${MAVIANCE_CONFIG.publicKey}:${MAVIANCE_CONFIG.secretKey}`).toString('base64');
    
    console.log('🔐 Tentative d\'authentification Maviance...');
    console.log('Public Key:', MAVIANCE_CONFIG.publicKey);
    console.log('Base URL:', `${MAVIANCE_CONFIG.baseUrl}/token`);
    
    const response = await axios.post(
      `${MAVIANCE_CONFIG.baseUrl}/token`,
      'grant_type=client_credentials',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${authString}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );
    
    console.log('✅ Token Maviance obtenu avec succès');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Erreur détaillée obtention token Maviance:');
    
    if (error.response) {
      console.error('📡 Statut:', error.response.status);
      console.error('📡 Données:', error.response.data);
      console.error('📡 Headers:', error.response.headers);
    } else if (error.request) {
      console.error('📡 Pas de réponse reçue:', error.request);
    } else {
      console.error('📡 Erreur de configuration:', error.message);
    }
    
    throw new Error(`Erreur d'authentification Maviance: ${error.response?.data?.error_description || error.message}`);
  }
}

// 🔥 Route de test de connexion
router.get("/test-connection", async (req, res) => {
  try {
    console.log("🧪 Test de connexion Maviance...");
    
    const config = {
      publicKey: MAVIANCE_CONFIG.publicKey,
      baseUrl: MAVIANCE_CONFIG.baseUrl,
      merchantNumber: MAVIANCE_CONFIG.merchantNumber,
      serviceIds: SERVICE_IDS
    };
    
    console.log("📋 Configuration:", config);
    
    // Tester l'authentification
    const token = await getMavianceAccessToken();
    
    return res.json({
      success: true,
      message: "✅ Connexion Maviance réussie",
      config: {
        ...config,
        publicKey: config.publicKey ? `${config.publicKey.substring(0, 10)}...` : 'non défini'
      },
      token: token ? `${token.substring(0, 20)}...` : null,
      environment: process.env.NODE_ENV || 'staging',
      status: "ACTIF"
    });
    
  } catch (error) {
    console.error("❌ Test de connexion échoué:", error.message);
    
    return res.status(500).json({
      success: false,
      message: "❌ Connexion Maviance échouée",
      error: error.message,
      config: {
        publicKey: MAVIANCE_CONFIG.publicKey ? "✓ Défini" : "✗ Manquant",
        secretKey: MAVIANCE_CONFIG.secretKey ? "✓ Défini" : "✗ Manquant",
        baseUrl: MAVIANCE_CONFIG.baseUrl,
        merchantNumber: MAVIANCE_CONFIG.merchantNumber
      }
    });
  }
});

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
        message: "Numéro de téléphone invalide (minimum 9 chiffres)"
      });
    }

    const serviceId = SERVICE_IDS[payment_method];
    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: "Méthode de paiement non supportée. Options: mtn, orange, express-union"
      });
    }

    // Nettoyer le numéro de téléphone
    const cleanPhone = phone.replace(/\D/g, '');
    
    // Générer une référence unique
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 10);
    const reference = `KAM-${timestamp}-${randomStr}`.toUpperCase();

    console.log(`📝 Référence générée: ${reference}`);
    console.log(`📱 Téléphone nettoyé: ${cleanPhone}`);
    console.log(`🔧 Service ID: ${serviceId}`);
    console.log(`🏪 Numéro marchand: ${MAVIANCE_CONFIG.merchantNumber}`);

    // 1. Obtenir le token d'accès
    console.log("🔐 Obtention du token d'accès Maviance...");
    const accessToken = await getMavianceAccessToken();
    console.log(`✅ Token obtenu: ${accessToken?.substring(0, 20)}...`);

    // 2. Préparer le payload pour Maviance selon la documentation
    const payload = {
      serviceid: serviceId,
      merchant: {
        number: MAVIANCE_CONFIG.merchantNumber
      },
      amount: {
        value: amount.toString(),
        currency: "XAF"
      },
      payer: {
        id: cleanPhone,
        name: req.user.user_metadata?.full_name || userEmail.split('@')[0],
        email: userEmail,
        phone: cleanPhone,
        type: "CUSTOMER"
      },
      orderid: reference,
      description: description,
      custom_data: {
        user_id: userId,
        app_name: "Kamerun News"
      },
      callback_url: "https://severbackendmavicince.onrender.com/api/payments/webhook/maviance",
      return_url: "https://severbackendmavicince.onrender.com/api/payments/status/success"
    };

    console.log("📤 Payload pour Maviance:");
    console.log(JSON.stringify(payload, null, 2));

    // 3. Envoyer la requête à l'API Maviance
    console.log("🚀 Envoi de la requête à Maviance API...");
    const response = await axios.post(
      `${MAVIANCE_CONFIG.baseUrl}/collect`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Correlation-ID': reference
        },
        timeout: 30000
      }
    );

    console.log("✅ Réponse Maviance reçue:");
    console.log(JSON.stringify(response.data, null, 2));

    // 4. Vérifier la réponse
    const data = response.data;
    
    if (!data.paymentUrl && !data.authorization_url && !data.url) {
      console.error("❌ Pas d'URL de paiement dans la réponse");
      return res.status(500).json({
        success: false,
        message: "Maviance n'a pas retourné d'URL de paiement",
        debug: data
      });
    }

    const paymentUrl = data.paymentUrl || data.authorization_url || data.url;
    console.log(`🔗 URL de paiement: ${paymentUrl}`);

    // 5. Créer l'enregistrement dans Supabase
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        reference: reference,
        amount: amount,
        currency: "XAF",
        status: "pending",
        provider: "maviance",
        payment_method: payment_method,
        phone_number: cleanPhone,
        metadata: JSON.stringify({
          description: description,
          service_id: serviceId,
          merchant_number: MAVIANCE_CONFIG.merchantNumber,
          maviance_response: data,
          payment_url: paymentUrl
        })
      })
      .select()
      .single();

    if (txError) {
      console.error("⚠️ Erreur création transaction Supabase:", txError);
      // Continuer quand même car Maviance a accepté la requête
    } else {
      console.log(`✅ Transaction créée dans Supabase: ${reference}`);
    }

    // 6. Retourner la réponse au frontend
    return res.json({
      success: true,
      message: "Paiement initialisé avec succès. Redirigez l'utilisateur vers l'URL de paiement.",
      data: {
        reference: reference,
        paymentUrl: paymentUrl,
        status: data.status || "PENDING",
        amount: amount,
        serviceId: serviceId,
        provider: "Maviance SmobilPay",
        instructions: "L'utilisateur doit être redirigé vers cette URL pour compléter le paiement",
        webhook_url: "https://severbackendmavicince.onrender.com/api/payments/webhook/maviance"
      }
    });

  } catch (error) {
    console.error("❌ Erreur détaillée lors de l'initialisation:");
    
    if (error.response) {
      console.error("📡 Statut HTTP:", error.response.status);
      console.error("📡 Headers:", error.response.headers);
      console.error("📡 Données:", JSON.stringify(error.response.data, null, 2));
      
      // Erreur d'authentification
      if (error.response.status === 401) {
        return res.status(401).json({
          success: false,
          message: "Erreur d'authentification avec Maviance. Vérifiez vos clés API.",
          debug: {
            url: `${MAVIANCE_CONFIG.baseUrl}/collect`,
            publicKey: MAVIANCE_CONFIG.publicKey,
            error: error.response.data
          }
        });
      }
      
      // Erreur de validation
      if (error.response.status === 400) {
        return res.status(400).json({
          success: false,
          message: "Erreur de validation des données",
          error: error.response.data
        });
      }
    }
    
    return res.status(500).json({
      success: false,
      message: "Erreur lors de l'initialisation du paiement",
      error: error.message,
      details: error.response?.data || "Aucun détail supplémentaire"
    });
  }
});

// 🔥 WEBHOOK MAVIANCE (simplifié)
router.post("/webhook/maviance", async (req, res) => {
  console.log("=== 📩 WEBHOOK MAVIANCE REÇU ===");
  
  try {
    const payload = req.body;
    console.log("📦 Données webhook:", JSON.stringify(payload, null, 2));

    const transactionReference = payload.orderid || payload.reference;
    const status = payload.status;

    if (!transactionReference) {
      console.error("❌ Référence manquante dans le webhook");
      return res.status(400).json({ success: false, message: "Référence manquante" });
    }

    console.log(`🔍 Traitement webhook: Référence=${transactionReference}, Statut=${status}`);

    // Mettre à jour simplement la transaction
    await supabase
      .from("transactions")
      .update({
        status: status === 'SUCCESSFUL' ? 'completed' : 
                status === 'FAILED' ? 'failed' : 'pending',
        updated_at: new Date().toISOString(),
        metadata: JSON.stringify({
          ...payload,
          webhook_received_at: new Date().toISOString()
        })
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
        
        console.log(`⭐ Utilisateur ${transaction.user_id} mis à jour en premium`);
      }
    }

    console.log(`✅ Webhook traité pour ${transactionReference}`);

    return res.status(200).json({ 
      success: true, 
      message: "Webhook traité",
      reference: transactionReference
    });

  } catch (error) {
    console.error("❌ Erreur traitement webhook:", error);
    return res.status(200).json({ 
      received: true, 
      error: error.message 
    });
  }
});

// 🔥 VÉRIFIER UN PAIEMENT (simplifié)
router.get("/verify/:reference", authenticateUser, async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;

    console.log(`🔍 Vérification paiement: ${reference}`);

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
      reference: transaction.reference,
      amount: transaction.amount,
      currency: transaction.currency,
      created_at: transaction.created_at,
      updated_at: transaction.updated_at,
      message: transaction.status === 'completed' ? 
        "Paiement confirmé ✅" : 
        transaction.status === 'failed' ? 
        "Paiement échoué ❌" : 
        "Paiement en attente ⏳"
    });

  } catch (error) {
    console.error("❌ Erreur vérification:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la vérification"
    });
  }
});

// 🔥 CONFIGURATION
router.get("/config", (req, res) => {
  return res.json({
    success: true,
    config: {
      provider: "Maviance SmobilPay",
      mode: process.env.NODE_ENV || 'staging',
      base_url: MAVIANCE_CONFIG.baseUrl,
      webhook_url: "https://severbackendmavicince.onrender.com/api/payments/webhook/maviance",
      supported_methods: Object.keys(SERVICE_IDS),
      status: "ACTIF",
      test_credentials: {
        public_key: MAVIANCE_CONFIG.publicKey ? `${MAVIANCE_CONFIG.publicKey.substring(0, 10)}...` : 'non défini',
        merchant_number: MAVIANCE_CONFIG.merchantNumber,
        test_phone: "690000000",
        test_amount: "1000 FCFA"
      }
    }
  });
});

module.exports = router;