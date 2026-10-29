using System;
using System.Collections.Generic;
using System.Globalization;
using Jellyfin.Plugin.MediaBarEnhanced.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.MediaBarEnhanced
{
    /// <summary>
    /// The main plugin.
    /// </summary>
    public class MediaBarEnhancedPlugin : BasePlugin<PluginConfiguration>, IHasWebPages
    {
        private readonly ScriptInjector _scriptInjector;
        private readonly ILoggerFactory _loggerFactory;

        /// <summary>
        /// Initializes a new instance of the <see cref="MediaBarEnhancedPlugin"/> class.
        /// </summary>
        /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
        /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
        /// <param name="loggerFactory">Instance of the <see cref="ILoggerFactory"/> interface.</param>
        public MediaBarEnhancedPlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer, ILoggerFactory loggerFactory)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
            _loggerFactory = loggerFactory;
            _scriptInjector = new ScriptInjector(applicationPaths, loggerFactory.CreateLogger<ScriptInjector>());

            if (Configuration.IsEnabled)
            {
                _scriptInjector.Inject();
            }
            else
            {
                _scriptInjector.Remove();
            }
        }

        /// <inheritdoc />
        public override void UpdateConfiguration(BasePluginConfiguration configuration)
        {
            var oldConfig = Configuration;
            base.UpdateConfiguration(configuration);

            if (Configuration.IsEnabled && !oldConfig.IsEnabled)
            {
                _scriptInjector.Inject();
            }
            else if (!Configuration.IsEnabled && oldConfig.IsEnabled)
            {
                _scriptInjector.Remove();
            }
        }

        /// <inheritdoc />
        public override string Name => "Media Bar Encore"; // Encore: own name

        /// <inheritdoc />
        public override Guid Id => Guid.Parse("a3c6e2f4-8b1d-4e7a-9c5f-6d2b8e4a1f37"); // Encore: own GUID

        /// <summary>
        /// Gets the current plugin instance.
        /// </summary>
        public static MediaBarEnhancedPlugin? Instance { get; private set; }

        /// <inheritdoc />
        public IEnumerable<PluginPageInfo> GetPages()
        {
            return
            [
                new PluginPageInfo
                {
                    Name = Name,
                    DisplayName = "Media Bar Encore", // Encore: own name
                    EnableInMainMenu = true,
                    MenuIcon = "view_carousel",
                    EmbeddedResourcePath = string.Format(CultureInfo.InvariantCulture, "{0}.Configuration.configPage.html", GetType().Namespace)
                }
            ];
        }

    }
}
